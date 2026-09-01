# AUDYT — system warsztatu samochodowego

Data: 2026-09-01 · Zakres: `frontend/`, `supabase/`, `narzedzia/`, dokumentacja
Stan repozytorium: gałąź `main`, commit `0a0c0ac`, drzewo czyste

> **Ten dokument jest wyłącznie diagnozą.** Nic w projekcie nie zostało zmienione —
> jedyny nowy plik to ten raport. Wszystkie zapytania do Supabase były odczytowe.

---

## 0. Podsumowanie w trzech zdaniach

Architektura jest dobra i konsekwentna: offline-first, deny-by-default w bazie,
kolumnowy UPDATE, trwała kolejka, idempotencja. Problemy nie leżą w projekcie,
tylko w **kilku miejscach, gdzie zabezpieczenie jest opisane, ale nie działa** —
i to jest gorsze niż jego brak, bo nikt go już nie sprawdzi. Trzy rzeczy trzeba
naprawić, zanim system dotknie prawdziwego warsztatu: **kopia zapasowa w ogóle
się nie wykonuje**, **auto-wipe zgubionego telefonu jest wyłączany przez zwykłą
niewysłaną zmianę**, a **lista „prośby o dostęp" jest wspólna dla wszystkich
warsztatów**.

### Tabela zbiorcza

| Waga | Ile | Czego dotyczy |
|---|---|---|
| 🔴 Krytyczne | 4 | izolacja warsztatów, kopie zapasowe, auto-wipe, blokada hasłem |
| 🟠 Wysokie | 10 | utrata danych lokalnych, wyścig przy parowaniu, cicha kwarantanna, odporność ekranów |
| 🟡 Średnie | 11 | wydajność (lista klientów, formularze), koszt wywołań Supabase, wyścigi |
| 🟢 Niskie | 16 | spójność, martwy kod, kosmetyka, numeracja migracji |
| 📄 Rozjazd dokumentacja↔kod | 9 | zabezpieczenia opisane, ale nieistniejące |

### Co zweryfikowano na żywo (produkcja `tpigqlvwjatlkhfqtlkt`)

| Sprawdzenie | Wynik |
|---|---|
| `tsc --noEmit` w `frontend/` | ✅ bez błędów |
| Security Advisor | ✅ tylko 13× INFO `rls_enabled_no_policy` (stan zamierzony), 0 błędów/ostrzeżeń |
| Performance Advisor | 8× INFO (nieindeksowane klucze obce), 5× nieużywany indeks |
| Migracje w bazie | ✅ wszystkie 14 zaaplikowane |
| `pg_cron` retencja | ✅ 3 uruchomienia, 0 nieudanych, ostatnie 2026-09-01 03:17 |
| Kwarantanna | ✅ 0 wpisów |
| Kolizje kluczy idempotencji | ✅ 0 (110 wpisów w `operacje`) |
| Sekrety w historii gita | ✅ brak — `narzedzia/.env` nigdy nie było commitowane |
| Zapytanie kopii zapasowej | ❌ **HTTP 400** na `numeratory` i `operacje` |

Dane produkcyjne dziś: 1 warsztat, 3 mechaników, 5 urządzeń, 3 klientów, 9 wizyt.
**Wiele problemów wydajnościowych jeszcze nie boli tylko dlatego, że baza jest pusta.**

---

## 1. 🔴 KRYTYCZNE

### K1 — Lista „prośby o dostęp" jest globalna; administrator może zatwierdzić cudzy telefon

**Gdzie:** `supabase/migracje/0012_zatwierdzanie_jednym_klikiem.sql:166-181`
(`dane_administracyjne`, sekcja `oczekujace`) oraz `:203-216`
(`admin_zatwierdz_urzadzenie`).

**Co jest nie tak.** Podzapytanie `oczekujace` nie ma **żadnego filtra po
warsztacie**:

```sql
from public.urzadzenia u
where u.przyznany_o is null and u.usuniete_o is null
  and u.kod_parowania is not null and u.kod_wygasa_o > now()
```

`admin_zatwierdz_urzadzenie` szuka kodu tak samo — globalnie, po całej tabeli.
Powód jest zrozumiały (przed zatwierdzeniem urządzenie nie ma jeszcze
`warsztat_id`), ale konsekwencje są dwie i obie poważne:

1. **Wyciek danych osobowych między warsztatami.** Administrator warsztatu B
   widzi na swojej liście imiona i nazwiska ludzi, którzy właśnie proszą
   o dostęp w warsztacie A — razem z nazwą i platformą ich telefonu. To dane
   osobowe wydane podmiotowi, który nie jest ich administratorem.
2. **Przejęcie telefonu.** Kto pierwszy kliknie „Zatwierdź", ten dostaje
   telefon do swojego warsztatu. Mechanik z warsztatu A ustawia hasło, wchodzi
   i widzi kartoteki warsztatu B — a jego własne zapisy lądują w bazie B.
   Ekran parowania nie pokazuje nawet, do jakiego warsztatu został przypisany.

Dziś w projekcie jest jeden warsztat, więc nic się nie dzieje. Ale cały model
usługi to **wiele warsztatów w jednym projekcie Supabase** (`utworz_zaproszenie`
zakłada kolejne), więc to zadziała przy drugim kliencie.

**Jak naprawić.** Zgłoszenie musi wskazywać warsztat, zanim trafi na czyjąkolwiek
listę. Najmniej inwazyjnie:

1. `alter table urzadzenia add column warsztat_zgloszony uuid references warsztaty(id);`
2. Mechanik przy prośbie podaje **prefiks warsztatu** (`WK`) — jest na numerach
   zleceń, wisi na kartce w warsztacie, nie jest sekretem i niczego nie
   autoryzuje. `parowanie/zglos` rozwiązuje prefiks na `warsztat_zgloszony`.
3. `dane_administracyjne` → `where u.warsztat_zgloszony = v_warsztat`.
4. `admin_zatwierdz_urzadzenie` → dodatkowy warunek
   `and u.warsztat_zgloszony = v_warsztat`, inaczej „Ten telefon nie zgłaszał
   się do Twojego warsztatu".
5. Ekran parowania po odebraniu tokenu pokazuje **nazwę warsztatu**, żeby
   mechanik zobaczył, gdzie trafił.

Wariant awaryjny na już (bez zmiany UX): sam punkt 4, oparty o dopasowanie
imienia — ale to nie zamyka wycieku z punktu 1.

---

### K2 — Kopia zapasowa nie działa. W ogóle.

**Gdzie:** `narzedzia/scripts/kopia-zapasowa.js:33`

```js
const czesc = await wybierz(tabela, `select=*&order=id.asc&limit=${strona}&offset=${offset}`);
```

**Co jest nie tak.** Sortowanie po `id` jest zaszyte na sztywno, a dwie tabele
z listy `TABELE` nie mają kolumny `id`:

- `numeratory` — klucz główny `(warsztat_id, rok)`
- `operacje` — klucz główny `klucz`

Sprawdzone na żywym projekcie:

```
warsztaty  -> HTTP 200  [{"id":"69a37707-…
numeratory -> HTTP 400  {"code":"42703","message":"column numeratory.id does not exist"}
operacje   -> HTTP 400  {"code":"42703","message":"column operacje.id does not exist"}
```

Skrypt przerywa się na szóstej tabeli, a `fs.writeFileSync` stoi **po** pętli —
więc **plik kopii nigdy nie powstaje**. `npm run kopia` kończy się komunikatem
„Kopia zapasowa NIE POWIODLA SIE" i zostawia pusty katalog.

To wywraca całe ryzyko **C1**. `BEZPIECZENSTWO.md` deklaruje je jako ✅
z dopiskiem „przetestowane odtwarzanie" — odtwarzanie nie mogło zostać
przetestowane, bo nie ma czego odtwarzać.

**Jak naprawić.**

1. Mapa kolumn sortujących zamiast sztywnego `id`:
   ```js
   const SORTOWANIE = {
     numeratory: 'warsztat_id.asc,rok.asc',
     operacje: 'klucz.asc',
   };
   const order = SORTOWANIE[tabela] ?? 'id.asc';
   ```
2. Dopisać do `TABELE` brakujące **`zaproszenia`** (dziś niewykorzystane kody
   zaproszeń przepadają przy odtwarzaniu) i rozważyć `limity` (albo świadomie
   pominąć jako dane ulotne).
3. Zapisywać plik nawet przy częściowym błędzie (albo do pliku tymczasowego
   i `rename` na końcu — atomowo).
4. **Do decyzji:** plik zawiera całą bazę klientów w jawnym JSON-ie na dysku
   dostawcy. Warto go szyfrować (np. `age`/GPG) albo przynajmniej opisać
   w `rodo/` jako osobną czynność przetwarzania.
5. Po naprawie **naprawdę** wykonać próbę odtworzenia na pustym projekcie —
   dopiero wtedy C1 wolno oznaczyć ✅.

---

### K3 — Auto-wipe zgubionego telefonu (A4) jest wyłączany przez jedną niewysłaną zmianę

**Gdzie:** `frontend/src/dane/synchronizacja.ts:333-338`

```js
const wysylka = await wyslijKolejke(token);
if (!wysylka.przerwane) await pobierzWszystko(token);

const czas = new Date().toISOString();
await ustawMeta('ostatnia_udana_sync', czas);   // ← wykonuje się ZAWSZE
```

**Co jest nie tak.** Gdy w kolejce coś czeka, a sieci nie ma, `wyslijKolejke`
łapie `BladSieci`, zwraca `{ przerwane: true }` i **nie rzuca dalej**. Pobieranie
zostaje pominięte, ale znacznik `ostatnia_udana_sync` i tak jest odświeżany na
„teraz".

Konsekwencje:

- **`sprawdzWygasniecieOffline()` (`:120-146`) nigdy nie zadziała.** Porównuje
  `ostatnia_udana_sync` z granicą 14 dni, a wartość odświeża się co 45 sekund
  w samolocie, w bunkrze i w kieszeni złodzieja. Skradziony telefon z jedną
  niewysłaną zmianą w kolejce **nie wyczyści się sam nigdy** — a to jedno
  z dwóch zabezpieczeń, na których stoi cała historia „zgubiony telefon czyści
  się sam".
- Wiek danych pokazywany użytkownikowi (gdyby kiedyś wrócił — patrz R2) byłby
  fałszywy.

Uwaga: przy **pustej** kolejce błąd leci z `pobierzWszystko` do zewnętrznego
`catch` i znacznik nie jest ustawiany — czyli zachowanie jest poprawne dokładnie
w tym wypadku, w którym nie ma czego chronić.

**Jak naprawić.** Rozdzielić „próbowaliśmy" od „udało się":

```js
let udanyKontakt = false;
const wysylka = await wyslijKolejke(token);
if (!wysylka.przerwane) {
  await pobierzWszystko(token);
  udanyKontakt = true;
}
if (udanyKontakt) await ustawMeta('ostatnia_udana_sync', czas);
```

Dodatkowo: gdy push się udał, a pull nie zdążył — to też jest udany kontakt
z serwerem, więc `wyslijKolejke` powinno zwracać informację „serwer odpowiedział
przynajmniej raz" i ona powinna sterować znacznikiem.

---

### K4 — `sprawdzHaslo()` wpuszcza do aplikacji, gdy nie może odczytać Keychain (fail-open)

**Gdzie:** `frontend/src/dane/sesja.ts:143-146` w połączeniu z
`frontend/src/dane/pamiecBezpieczna.ts:36-39`

```ts
// pamiecBezpieczna.ts
return SecureStore.getItemAsync(klucz, OPCJE).catch(() => null);   // błąd == brak

// sesja.ts
const sol = await czytaj(K_SOL);
const oczekiwany = await czytaj(K_WERYFIKATOR);
if (!sol || !oczekiwany) return { ok: true };   // ← wpuszcza
```

**Co jest nie tak.** `czytaj()` połyka **każdy** wyjątek z Keystore/Keychain
i zwraca `null`. `sprawdzHaslo()` interpretuje `null` jako „hasło jeszcze nie
ustawione" i zwraca `{ ok: true }` — czyli **dowolny wpisany ciąg znaków
odblokowuje aplikację z pełnymi danymi klientów**. Wystarczy chwilowa
niedostępność Keystore (Android po restarcie przed pierwszym odblokowaniem,
uszkodzony wpis, przywrócenie systemu).

**Druga, pewniejsza ścieżka do tego samego stanu:** po 10 nieudanych próbach
`sprawdzHaslo` woła `wyczyscWszystko()` (`:157`), która kasuje weryfikator —
ale faza aplikacji zostaje `zablokowana` i **nikt nie informuje kontekstu**.
Kolejna dowolna próba trafia w `if (!sol || !oczekiwany) return { ok: true }`,
`EkranOdblokowania` woła `odblokowano()` i użytkownik ląduje w fazie `gotowa`
z pustą bazą i bez tokenu — zamiast wrócić na ekran parowania.

**Jak naprawić.**

1. `czytaj()` nie może zrównywać błędu z brakiem. Zwracać
   `{ stan: 'jest' | 'brak' | 'blad', wartosc }` albo rzucać dedykowany wyjątek.
2. `sprawdzHaslo()`: przy błędzie odczytu → `{ ok: false, blad: 'awaria' }`
   i komunikat „nie można odczytać zabezpieczeń tego telefonu", nigdy `ok:true`.
3. Przy realnym braku weryfikatora, ale obecnym tokenie → faza `ustaw_haslo`
   (już istnieje), nie „wchodź".
4. Po `{ wyczyszczono: true }` w `EkranBlokady.tsx:~200` wywołać `odswiezFaze()`,
   żeby aplikacja przeszła do `parowanie`.

---

## 2. 🟠 WYSOKIE

### W1 — Pierwsze nieudane otwarcie bazy kasuje bazę razem z niewysłaną kolejką

**Gdzie:** `frontend/src/dane/baza.ts:190-201` oraz `:52-59`

```ts
try {
  db = await otworzZaszyfrowana();
} catch {
  await SQLite.deleteDatabaseAsync(NAZWA_BAZY).catch(() => undefined);   // ← bez pytania
  db = await otworzZaszyfrowana();
}
```

W parze z tym `kluczBazy()`:

```ts
const istniejacy = await czytaj(K_KLUCZ_BAZY);
if (istniejacy && /^[0-9a-f]{64}$/.test(istniejacy)) return istniejacy;
const nowy = …;              // błąd odczytu Keystore → GENERUJEMY NOWY KLUCZ
await zapisz(K_KLUCZ_BAZY, nowy);   // …i NADPISUJEMY stary, bezpowrotnie
```

**Scenariusz utraty danych.** Chwilowa awaria odczytu Keystore →
`czytaj()` zwraca `null` (patrz K4) → generowany jest nowy klucz i **nadpisuje**
prawidłowy → `PRAGMA key` nie pasuje do pliku → `SELECT` rzuca → `catch` kasuje
plik bazy → aplikacja startuje z pustą bazą. Znika cała kolejka wysyłkowa,
czyli praca, która nie zdążyła dojechać do serwera. Bez jednego komunikatu.

**Jak naprawić.**

1. `kluczBazy()` generuje nowy klucz **wyłącznie** wtedy, gdy magazyn
   jednoznacznie odpowiedział „nie ma takiego wpisu". Przy błędzie — rzucić.
2. Nie kasować bazy odruchowo. Najpierw druga próba otwarcia; przy powtórnym
   niepowodzeniu pokazać ekran `brak_bazy` (już istnieje) z jawnym pytaniem
   „założyć bazę od nowa? utracisz N niewysłanych zmian".
3. Przed skasowaniem zmienić nazwę pliku na `warsztat.db.uszkodzona`, żeby dało
   się go jeszcze uratować, jeśli klucz się odnajdzie.

---

### W2 — Wyścig przy wydawaniu tokenu może dać telefonowi token, którego serwer nie zna

**Gdzie:** `supabase/funkcje/parowanie/index.ts:222-240`

```ts
const token = losowyHex(32);
await db.from("urzadzenia").update({ token_hash: await sha256(token), … })
        .eq("id", id).is("token_hash", null);

const { data: po } = await db.from("urzadzenia").select("token_hash").eq("id", id).maybeSingle();
if (!po?.token_hash) return odpowiedz(409, { kod: "TOKEN_JUZ_WYDANY" });
// …i zwracamy `token` — nawet jeśli w bazie leży hash CUDZEGO tokenu
```

**Co jest nie tak.** Sprawdzenie po UPDATE weryfikuje tylko, czy **jakikolwiek**
`token_hash` istnieje — nie czy to hash tokenu wygenerowanego w tym żądaniu.
Przy dwóch równoległych `sprawdz` (a ekran parowania odpytuje co 5 s i **nie
czeka** na poprzednią odpowiedź — `EkranParowania.tsx:177-180`) drugie żądanie
robi UPDATE bez efektu, widzi hash pierwszego i zwraca 200 razem z własnym,
nigdzie niezapisanym tokenem.

**Skutek dla mechanika:** telefon zapisuje martwy token, pierwszy `sync` dostaje
401 `NIEZNANY_TOKEN`, aplikacja traktuje to jako `BladDostepu` → `wyczyscWszystko()`
→ ekran „Dostęp został odebrany" **tuż po udanym sparowaniu**. Objaw jest
mylący: wygląda jak złośliwość administratora.

**Jak naprawić.**

```ts
const { data: zaktualizowane } = await db.from("urzadzenia")
  .update({ … }).eq("id", id).is("token_hash", null).select("id");
if (!zaktualizowane?.length) return odpowiedz(409, { kod: "TOKEN_JUZ_WYDANY" });
```

Po stronie telefonu: nie odpalać kolejnego `sprawdz`, dopóki poprzedni nie
wrócił (flaga `wTrakcie` w `EkranParowania.tsx`).

---

### W3 — Klucz idempotencji może się zderzyć po odtworzeniu lokalnej bazy → ciche zgubienie zapisów

**Gdzie:** `supabase/funkcje/sync/index.ts:243`

```ts
const klucz = `${sesja.urzadzenie_id}:${idLokalne || crypto.randomUUID()}`;
```

`idLokalne` to `kolejka.id` — `INTEGER PRIMARY KEY AUTOINCREMENT` z lokalnej
bazy telefonu.

**Co jest nie tak.** Jeśli lokalna baza zostanie odtworzona od zera (scenariusz
W1 — plik skasowany, token w Keystore **zostaje**), numeracja kolejki startuje
od 1. Klucze `<to samo urzadzenie>:1`, `:2`, `:3` już są w tabeli `operacje`
(czyszczona dopiero po 30 dniach). Serwer zwróci zapamiętany wynik z dopiskiem
`powtorka: true`, telefon uzna pozycję za przyjętą i usunie ją z kolejki —
a **do bazy nic nie trafi**.

Dziś: 110 wpisów w `operacje`, 0 kolizji — bo scenariusz jeszcze nie wystąpił.

**Jak naprawić.** Klucz idempotencji nie może zależeć od licznika, który da się
zresetować. Dodać do tabeli `kolejka` kolumnę `uuid TEXT NOT NULL` (generowaną
przy `dodajDoKolejki`) i wysyłać ją jako `id_lokalne`. Zmiana jest addytywna,
zgodna z B10.

---

### W4 — Kwarantanna nie ma żadnego odbiorcy: zapis może zniknąć bez śladu dla użytkownika

**Gdzie:** `frontend/src/dane/synchronizacja.ts:189, 228-232` (liczba jest
liczona), `supabase/migracje/0004:75` (`raport_synchronizacji()` — nikt tego nie
woła), `README.md` („zajrzyj do tabeli `kwarantanna` w panelu Supabase").

**Co jest nie tak.** Model B8 jest zrealizowany poprawnie: serwer nigdy nie
odrzuca zapisu trwałym błędem, tylko odkłada go do kwarantanny i potwierdza
przyjęcie. Ale **potwierdzenie przyjęcia jest dla telefonu nieodróżnialne od
sukcesu**: kropka w Ustawieniach pokazuje `✓`, licznik spada do zera, mechanik
widzi „wszystko wysłane". Zapis leży w tabeli, do której nikt nie zagląda.

Zmienna `kwarantanna` w `WynikWysylki` jest zliczana i nigdzie nie używana.

**Jak naprawić.**

1. Dodać do `StanSynchronizacji` pole `wKwarantannie` i pokazać je na ekranie
   ⚙ obok kropki („N zapisów serwer odłożył do sprawdzenia").
2. Na ekranie „Dostęp" sekcja dla administratora oparta o `raport_synchronizacji()`
   — telefony milczące >24 h i liczba wpisów w kwarantannie. Funkcja już
   istnieje, wystarczy ją wystawić przez funkcję brzegową `admin`.
3. Docelowo: powiadomienie do dostawcy (webhook / cron sprawdzający
   `count(*) from kwarantanna where rozwiazane_o is null`).

---

### W5 — Nieudana aktywacja zaproszenia zostawia pusty warsztat i konto administratora

**Gdzie:** `supabase/migracje/0012_zatwierdzanie_jednym_klikiem.sql:88-120`

```sql
insert into public.warsztaty …          -- powstaje
insert into public.mechanicy …          -- powstaje

update public.urzadzenia … where id = p_urzadzenie and przyznany_o is null …;
if not found then
  return jsonb_build_object('ok', false, 'blad', 'To urzadzenie ma juz przyznany dostep');
end if;                                  -- ← RETURN zatwierdza transakcję
```

**Co jest nie tak.** `RETURN` w PL/pgSQL nie wycofuje niczego. Przy nieudanym
UPDATE (urządzenie już sparowane) w bazie zostaje pusty warsztat z zajętym
prefiksem i konto administratora bez telefonu, a **kod zaproszenia nadal jest
nieużyty** — więc powtórzenie próby tworzy kolejną parę śmieci. Ma to też
skutek dla K1: każdy taki duch to kolejny „warsztat" w systemie.

**Jak naprawić.** Sprawdzać stan urządzenia **przed** wstawkami, albo zamienić
`return jsonb_build_object('ok', false, …)` na `raise exception` (transakcja
się wycofa), a komunikat złapać w funkcji brzegowej. To samo dotyczy wersji
z `0010_administrator_w_aplikacji.sql:105-120`.

---

### W6 — Rekordy skasowane w chmurze żyją na telefonie bez końca

**Gdzie:** `frontend/src/dane/repozytorium.ts:449-462` (`posprzatajPozaOknem`)

Lokalne sprzątanie kasuje wyłącznie wizyty **naprawione** starsze niż okno.
Rekordy z ustawionym `usuniete_o` (klienci i wizyty) zostają w lokalnej bazie
w nieskończoność — a gdy `zadanie_retencji()` usunie je fizycznie na serwerze,
telefon nigdy się o tym nie dowie (pull przysyła tylko wiersze istniejące).

**Skutek RODO:** dane usunięte i „wyretencjonowane" w chmurze pozostają na
telefonach mechaników bez żadnego terminu — czyli ograniczenie przechowywania
(A15) obowiązuje tylko po stronie serwera.

**Jak naprawić.** Rozszerzyć `posprzatajPozaOknem`:

```sql
DELETE FROM wizyty  WHERE usuniete_o IS NOT NULL AND usuniete_o < ? AND oczekuje = 0;
DELETE FROM klienci WHERE usuniete_o IS NOT NULL AND usuniete_o < ?
   AND oczekuje = 0 AND id NOT IN (SELECT klient_id FROM wizyty);
```

---

### W7 — Usunięcie klienta nie kaskaduje na serwer; retencja kartotek nigdy nie zadziała

**Gdzie:** `frontend/src/dane/repozytorium.ts:250-258`,
`supabase/migracje/0013:…` (gałąź `usun`), `supabase/migracje/0004:28-38`

Trzy powiązane usterki:

1. `usunKlienta()` oznacza wizyty klienta jako usunięte **tylko lokalnie**;
   do kolejki idzie sam `usun` na kliencie. Serwer nie kaskaduje — wizyty
   zostają żywe i wracają przy najbliższym pull z `usuniete_o = NULL`.
2. `otwarteUsterki()` (`:130`) nie filtruje po `k.usuniete_o`, więc wizyty
   usuniętego klienta wrócą na ekran „Otwarte usterki" z jego nazwiskiem.
3. `zadanie_retencji()` kasuje kartotekę tylko gdy
   `not exists (select 1 from wizyty w where w.klient_id = k.id)` — a wizyty
   znikają dopiero, gdy same mają `usuniete_o`. Przy braku kaskady z punktu 1
   **żadna kartoteka klienta nigdy nie zostanie fizycznie usunięta.**

**Dziś nieaktywne:** `usunKlienta` nie ma ani jednego wywołania w interfejsie
(martwy kod — patrz N11). To pułapka na dzień, w którym ktoś doda przycisk.

**Jak naprawić.** Kaskadę w `zapisz_z_telefonu` (`usun` na `klienci` →
`update wizyty set usuniete_o = now() where klient_id = p_rekord`), filtr
`k.usuniete_o IS NULL` w `otwarteUsterki()`, i osobny krok retencji dla
kartotek, których wszystkie wizyty są już skasowane.

---

### W8 — Błąd odczytu na ekranie = kręciołek bez końca

**Gdzie:** `app/index.tsx:44-47`, `app/usterki.tsx:47-50`,
`app/klient/[id].tsx:59-70`, `app/wizyta/[id].tsx:63-66`

```ts
const wczytaj = useCallback(async () => {
  setUsterki(await otwarteUsterki());   // rzuca → poniższa linia się nie wykona
  setLadowanie(false);
}, []);
```

Żaden z tych ekranów nie ma `try/catch/finally`. Odrzucona obietnica (baza
zamknięta po `wyczyscWszystko`, błąd SQLite, uszkodzony wiersz) zostawia ekran
na `Ladowanie` **na zawsze** i produkuje unhandled rejection. To dokładnie ten
sam objaw, który w `kontekst.tsx` został świadomie naprawiony (faza `brak_bazy`),
ale na ekranach roboczych nie.

**Jak naprawić.** `try { … } catch (e) { setBlad(…) } finally { setLadowanie(false) }`
i pokazać istniejący komponent `KomunikatBledu` z przyciskiem ponowienia.

---

### W9 — `chmura.ts` może zwrócić `null` przy odpowiedzi 200

**Gdzie:** `frontend/src/dane/chmura.ts:88`

```ts
const dane = await odpowiedz.json().catch(() => null);
…
return dane;   // null przy 200 z nie-JSON (proxy, WAF, pusty body)
```

Wywołujący zakładają obiekt. `pobierzWszystko` zrobi `odp.wymaga_aktualizacji`
→ TypeError (wpadnie w ogólny `catch`, więc niegroźnie), ale
`daneAdmina` → `setDane(null)` i ekran „Dostęp" pokaże **pustą listę mechaników
zamiast błędu** — administrator uzna, że warsztat jest pusty.

**Jak naprawić:** przy `dane === null` i statusie 2xx rzucić
`new BladSieci('Nieczytelna odpowiedź serwera.')`.

---

### W10 — Kolejka jednak potrafi się zatkać (sprzecznie z B8)

**Gdzie:** `frontend/src/dane/synchronizacja.ts:206` i `:226`

```ts
pola: JSON.parse(p.pola),                    // poza try — wyjątek ubija cały cykl
…
przyjete.push(Number(wynik.id_lokalne));     // NaN → DELETE nic nie usunie
```

1. `JSON.parse` na uszkodzonym wierszu rzuca **przed** blokiem `try`, wyjątek
   leci z `wyslijKolejke` do `catch` w `synchronizuj` i **każdy kolejny cykl
   wywali się na tej samej pozycji**. Kolejka staje na stałe — dokładnie to,
   czemu B8 miało zapobiec.
2. Gdyby serwer zwrócił nieliczbowe `id_lokalne`, `Number()` daje `NaN`,
   `DELETE … WHERE id IN (NaN)` nie usuwa nic, a pozycja jest wysyłana
   w kółko.

**Jak naprawić.** Parsować w `try` i pozycję nie do odczytania od razu
przenieść do kwarantanny lokalnej (albo skasować z wpisem do logu); walidować
`Number.isInteger(id)` przed `usunZKolejki`.

---

## 3. 🟡 ŚREDNIE — wydajność i koszty

### Pomiar odniesienia

Zapytania z `repozytorium.ts` uruchomione 1:1 na syntetycznych danych
(better-sqlite3, natywnie, desktop — plik poza projektem, skasowany po pomiarze):

| Dane | `listaKlientow()` | `otwarteUsterki()` | `otwartaWizytaTegoAuta()` |
|---|---|---|---|
| 200 klientów / 1 000 wizyt | 2,6 ms | 0,7 ms | 0,6 ms |
| 1 000 / 8 000 | 15,2 ms | 5,1 ms | 4,4 ms |
| 3 000 / 30 000 | 54,4 ms | 15,1 ms | 14,7 ms |
| 6 000 / 72 000 | **127,3 ms** | 45,5 ms | 45,5 ms |

Na telefonie przez `expo-sqlite` (asynchronicznie, wolniejszy CPU) realnie
**×3–10**. Czyli przy 6 000 kartotek `listaKlientow()` to ok. **0,4–1,3 s**.

---

### S1 — `listaKlientow()`: sześć skorelowanych podzapytań na klienta, przy każdym wejściu na ekran

**Gdzie:** `repozytorium.ts:33-56`, wołane z `app/index.tsx:52` przez
`useFocusEffect` — czyli **przy każdym powrocie** z profilu, z formularza, z modala.

Dla każdego klienta baza wykonuje osobno: `COUNT(*)`, `COUNT(*)` z filtrem,
`COUNT(DISTINCT)`, `GROUP_CONCAT(DISTINCT)`, `MAX()` — plus sortowanie po
wyliczonej kolumnie (bez możliwości użycia indeksu).

**Jak naprawić.**

1. Jedno zapytanie z `LEFT JOIN wizyty … GROUP BY k.id` zamiast sześciu
   podzapytań (jeden przebieg po `wizyty` zamiast sześciu na klienta).
2. Indeks pokrywający: `CREATE INDEX idx_wizyty_klient_stan ON wizyty (klient_id, usuniete_o, status)`.
3. Nie przeładowywać całej listy przy każdym focusie — trzymać licznik wersji
   danych (bump po zapisie i po udanej synchronizacji) i przeładowywać tylko
   gdy się zmienił.

---

### S2 — To samo ciężkie zapytanie leci przy **każdej literze** numeru telefonu

**Gdzie:** `app/klient/nowy.tsx:39-44` → `repozytorium.ts:144-149`

```ts
useEffect(() => { klienciZTymSamymTelefonem(telefon).then(setPodobni); }, [telefon]);
…
export async function klienciZTymSamymTelefonem(telefon: string) {
  const wszyscy = await listaKlientow();      // ← PEŁNA lista z wszystkimi licznikami
  return wszyscy.filter((k) => samCyfry(k.telefon) === numer);
}
```

Żeby sprawdzić jeden numer telefonu, aplikacja liczy komplet statystyk dla
**wszystkich** klientów — i robi to bez debounce, po każdym naciśnięciu klawisza
od szóstej cyfry wzwyż. To najdroższa pojedyncza rzecz w całym interfejsie.

**Jak naprawić.**

1. Osobne, wąskie zapytanie: `SELECT id, nazwa, telefon FROM klienci WHERE usuniete_o IS NULL`.
2. Docelowo kolumna `telefon_norm` w lokalnej bazie (dokładnie jak w Postgresie,
   `norm_telefon`) + indeks → zapytanie punktowe zamiast skanu.
3. Debounce 300 ms na polu telefonu.

---

### S3 — Ostrzeżenie o duplikacie auta przeliczane przy każdej literze pola AUTO

**Gdzie:** `app/wizyta/nowa.tsx:55-59` → `repozytorium.ts:155-170`

Ciągnie **wszystkie** otwarte wizyty z ostatnich 48 h (pełne wiersze + JOIN)
i filtruje je w JavaScripcie, przy każdym znaku wpisywanym w wielolinijkowe
pole. Bez debounce, bez `LIMIT`.

**Jak naprawić:** debounce 300 ms, `LIMIT 200`, porównanie po znormalizowanej
kolumnie w SQL zamiast w JS.

---

### S4 — Wejście na profil klienta uruchamia pełną `listaKlientow()`

**Gdzie:** `app/klient/[id].tsx:63` — `klienciZTymSamymTelefonem(dane.telefon)`
tylko po to, żeby ewentualnie pokazać kartę „możliwy duplikat". Naprawa jak S2.

---

### S5 — 500 rund SHA-256 przez most natywny przy każdym odblokowaniu

**Gdzie:** `frontend/src/dane/sesja.ts:113-120`

```ts
const RUNDY = 500;
for (let i = 0; i < RUNDY; i += 1) {
  wartosc = await Crypto.digestStringAsync(SHA256, wartosc);   // 500 przeskoków przez most
}
```

To 500 **sekwencyjnych** wywołań asynchronicznych — zauważalna zwłoka po
naciśnięciu „Odblokuj" i drugie tyle przy ustawianiu hasła.

Przy okazji: jako KDF to jednocześnie **słaby** wybór (SHA-256 bez
pamięciochłonności, 500 rund to dziś nic). Skoro i tak trzeba to ruszyć, lepiej
jedno wywołanie PBKDF2/scrypt po stronie natywnej niż 500 przeskoków. Uwaga —
zmiana algorytmu **unieważni istniejące hasła**, więc wymaga migracji
(przechować `wersja_kdf` obok weryfikatora).

---

### S6 — Ekran „Dostęp" odpytuje funkcję brzegową co 15 sekund

**Gdzie:** `app/administracja.tsx:88-91`

```ts
const licznik = setInterval(() => wczytaj(true), 15_000);
```

240 wywołań `admin` na godzinę na jedno urządzenie, niezależnie od tego, czy
cokolwiek się dzieje. Do tego cykl sync co 45 s (80/h, także przy zablokowanym
ekranie) i odpytywanie parowania co 5 s (720/h w trakcie parowania).

**Jak naprawić:** `useFocusEffect` zamiast `useEffect` (dziś interwał chodzi
także wtedy, gdy ekran jest przykryty innym), pauza gdy `AppState !== 'active'`,
i wydłużenie interwału do 30–60 s po kilku odpowiedziach bez zmian.

---

### S7 — `VACUUM` przy każdym czyszczeniu danych

**Gdzie:** `frontend/src/dane/baza.ts:270-278`

`VACUUM` przepisuje cały plik bazy — przy dużej bazie to sekundy blokady,
a w przeglądarce (OPFS) potrafi się nie powieść. A ponieważ
`wyczyscWszystko()` (`sesja.ts:198-207`) nie ma `try`, wyjątek z `VACUUM`
**przerwie całą operację przed `skasujKluczBazy()`** — token i hasło skasowane,
klucz szyfrowania i plik bazy zostają. Dokładnie odwrotnie niż zamierzono.

**Jak naprawić.** Odwrócić kolejność (najpierw kasowanie kluczy i tokenów,
potem sprzątanie pliku) i owinąć `VACUUM` w osobny `try`.

---

### S8 — `ustawienia.tsx` czyta bazę przy każdej zmianie obiektu `sync`

**Gdzie:** `app/ustawienia.tsx:47-52` — `useEffect(…, [sync])`, a `sync` to
**nowy obiekt** przy każdym `ustawStan` (kilka razy na cykl synchronizacji).
Cztery odczyty z bazy za każdym razem. Naprawa: zależność
`[sync.ostatniaUdana, sync.trwa]`.

---

### S9 — Dwa równoległe cykle synchronizacji

**Gdzie:** `frontend/src/dane/synchronizacja.ts:318-329`

```ts
if (stan.trwa) return stan;                       // ← sprawdzenie
if (!opcje.wymuszona && …) return stan;
if (await sprawdzWygasniecieOffline()) return stan;   // ← await
const token = await pobierzToken();                   // ← await
ustawStan({ trwa: true, … });                     // ← ustawienie flagi dopiero tutaj
```

Między sprawdzeniem a ustawieniem flagi są dwa `await`. Wywołania „wymuszone"
(pull-to-refresh, powrót sieci, timer ponowienia, kropka w Ustawieniach) omijają
też throttle `MIN_PRZERWA_SYNC_MS`. Dwa przebiegi wyślą tę samą paczkę
dwukrotnie — idempotencja serwera to złapie, ale to podwójny ruch i podwójne
`usunZKolejki`. Naprawa: ustawiać flagę synchronicznie, na samym początku.

---

### S10 — Listy bez memoizacji

`app/index.tsx:186`, `app/usterki.tsx:141`, `app/klient/[id].tsx:271` —
`renderItem` to inline arrow, `KafelekKlienta`/`KafelekWizyty` nie są objęte
`React.memo`. Przy 1 000+ pozycjach każda litera w wyszukiwarce przerysowuje
widoczne wiersze.

Uwaga: w `app.json` włączony jest `experiments.reactCompiler: true`, który
częściowo to załatwia automatycznie — ale **to trzeba zmierzyć na realnym
buildzie**, a nie założyć.

---

### S11 — Filtr „na żywo" normalizuje wszystkie teksty przy każdej literze

**Gdzie:** `app/index.tsx:64-72` — `doPorownania()` sklejonych pięciu pól dla
każdego klienta, przy każdym naciśnięciu klawisza. Przy 6 000 klientów to
30 000 alokacji stringów na literę.

**Jak naprawić:** policzyć „stóg" raz, w `useMemo` zależnym od `klienci`,
i filtrować po gotowej tablicy.

---

## 4. 🟢 NISKIE — spójność, martwy kod, kosmetyka

| Id | Miejsce | Rzecz |
|---|---|---|
| **N1** | `supabase/migracje/` | **Dwie migracje o numerze 0012** (`0012_karencja…`, `0012_zatwierdzanie…`). Na produkcji zaaplikowane w kolejności *zatwierdzanie → karencja*; alfabetycznie (czyli tak, jak zrobi `supabase db push` na czystym projekcie) będzie odwrotnie. Tu akurat nie kolidują, ale numerację trzeba naprawić, zanim kogoś ugryzie. |
| **N2** | `dane/konfiguracja.ts:KARENCJA_USUWANIA_DNI` | Karencja usuwania zaszyta w aplikacji na 30 dni, a baza trzyma `warsztaty.karencja_usuwania_dni`. Zmiana w panelu **nie dojedzie do telefonu** — `sync` nie odsyła tej wartości. Ekran pokaże inną liczbę dni niż faktycznie egzekwuje serwer. Naprawa: dopisać pole do `wspolne.warsztat` w `funkcje/sync/index.ts` i zapisać w meta. |
| **N3** | `repozytorium.ts:~355` vs `:380` | `zaktualizujWizyte` nie ustawia lokalnie `naprawione_o` (robi to trigger w bazie). Do czasu, aż serwer odeśle wiersz, `ocenUsuwanieWizyty` liczy karencję od `new Date()` — więc **bez sieci licznik „pozostało 30 dni" nie rusza z miejsca** przy każdym uruchomieniu. Naprawa: ustawiać `naprawione_o` lokalnie przy przejściu na `naprawione` i czyścić przy powrocie — dokładnie jak `trg_wizyty_naprawione`. |
| **N4** | `dane/baza.ts:145-149, 205-210` | Migracje lokalnej bazy nie są idempotentne ani transakcyjne: `ALTER TABLE … ADD COLUMN` wywali się przy ponownym przebiegu, a `PRAGMA user_version` jest ustawiane **osobnym** `execAsync` po migracji. Przerwanie między nimi zostawia bazę w stanie nie do zmigrowania — na co `otworzIZmigruj` odpowie skasowaniem bazy (W1). Naprawa: migracja + `PRAGMA user_version` w jednej transakcji, `ALTER` poprzedzony `PRAGMA table_info`. |
| **N5** | `repozytorium.ts:SQL_AUTA` / `wizytyKlienta` | `COLLATE NOCASE` w SQLite działa tylko na ASCII — „Świerk" i „ŚWIERK" dadzą dwie osobne zakładki auta. Postgres ma na to `norm_tekst`; lokalna baza nie ma odpowiednika. |
| **N6** | `app/klient/[id].tsx:72-76` | `useFocusEffect` ma zależność `[klientId]`, więc zamraża pierwszą wersję `wczytajWszystko` z `wybraneAuto = null`. Po wejściu w wizytę i powrocie: zakładka auta nadal podświetlona, ale historia pokazuje **wszystkie** auta. |
| **N7** | `app/ustawienia.tsx` + `_layout.tsx:88` | „Zablokuj aplikację teraz" odmontowuje cały `<Stack>`; po odblokowaniu użytkownik wraca na listę klientów, nie tam, gdzie był. |
| **N8** | `app/administracja.tsx:71-79` | Parametr `cichoBlad` wpływa tylko na *czyszczenie* błędu — `setBlad(…)` wykonuje się zawsze. Przy chwilowym braku sieci co 15 s wyskakuje czerwony komunikat, choć to odświeżanie w tle. |
| **N9** | `app/klient/[id].tsx` | `Linking.openURL('tel:…')` bez `.catch` — na tablecie bez modułu telefonicznego da odrzuconą obietnicę. |
| **N10** | `frontend/app.json` | Każda pozycja w `android.blockedPermissions` wpisana **dwa razy**. Bez skutku, ale sygnał, że plik był sklejany ręcznie. |
| **N11** | różne | **Martwy kod:** `usunKlienta` (0 użyć — i ma niedokończoną kaskadę, W7), `formatujRozmiar`, `dodajMechanika`, `przyznajDostep`, `sprawdzStan`, `SZEROKOSC_KOLUMNY`. |
| **N12** | `0010:utworz_zaproszenie` | Kody zaproszeń losowane przez `random()`, nie CSPRNG. Entropia (12 znaków × alfabet 32) wystarcza, ale generator jest przewidywalny przy znajomości stanu. Naprawa: `gen_random_bytes()` z pgcrypto. Dodatkowo pętla `for proba in 1..10` przy dziesięciu kolizjach i tak wykona `insert` → błąd klucza głównego. |
| **N13** | `funkcje/parowanie/index.ts:zgloszenieZSekretem` | Porównanie hashy przez `!==` (nie w stałym czasie). Praktycznie nieistotne przy 256-bitowym sekrecie, ale to jedno miejsce warto poprawić przy okazji. |
| **N14** | `funkcje/parowanie`, `funkcje/admin` | Limit tempa mają tylko `zglos` (20/h/IP) i `aktywuj_zaproszenie` (30/h/IP). `sprawdz`, `haslo_ustawione` i **wszystkie** akcje `admin` nie mają żadnego. |
| **N15** | wszystkie trzy funkcje brzegowe | `Access-Control-Allow-Origin: *`. Token jedzie własnym nagłówkiem, więc przeglądarka go nie doklei — ale każda strona w internecie może wołać `parowanie/zglos` i zapychać administratorom listę oczekujących (ograniczone tylko limitem IP). |
| **N16** | `dane/sesja.ts:198-207` | `wyczyscWszystko()` bez `try` — patrz S7. Jeśli `wyczyscDaneWarsztatu()` rzuci, `skasujKluczBazy()` nigdy się nie wykona. |

---

## 5. 📄 Rozjazdy: dokumentacja obiecuje zabezpieczenia, których nie ma

To osobna kategoria, bo jest **groźniejsza niż zwykły błąd**: `BEZPIECZENSTWO.md`
jest listą kontrolną, po której ktoś kiedyś oceni, czy system jest gotowy.
Pozycja oznaczona ✅ nie zostanie ponownie sprawdzona.

| Id | Deklaracja | Stan faktyczny |
|---|---|---|
| **R1** | README + `BEZPIECZENSTWO.md` (A4): *„aplikacja przez cały czas wyświetla pomarańczowy pasek »TRYB PODGLĄDU — brak szyfrowania danych«"* | **Takiego komponentu nie ma.** `TRYB_PODGLADU` jest użyte wyłącznie w komunikacie o błędzie bazy i w etykiecie przycisku (`_layout.tsx:72`, `kontekst.tsx:127,148`). **Wersja webowa wygląda identycznie jak APK** — nic nie ostrzega, że token, hasło i cała baza leżą w zwykłym `localStorage`/OPFS. |
| **R2** | `BEZPIECZENSTWO.md` D4: *„Stały pasek nad każdą listą: dane aktualne / sprzed 14 min / sprzed 3 dni"* + odnośnik do `frontend/src/komponenty/PasekSynchronizacji.tsx` | **Plik nie istnieje**, paska nie ma. README opisuje to poprawnie („synchronizacja niewidoczna"), `BEZPIECZENSTWO.md` nie. Ryzyko D4 jest w praktyce **nieobsłużone** — mechanik nie ma jak się dowiedzieć, że patrzy na dane sprzed trzech dni. |
| **R3** | `BEZPIECZENSTWO.md` D5: *„znacznik ⏱ czeka przy każdym rekordzie"*, *„ostrzeżenie, gdy najstarsza pozycja czeka ponad dobę"* | Kolumna `oczekuje` jest pobierana z bazy i **nigdzie nie renderowana**; `najstarszaCzeka` jest liczone (`kolejka.ts:105`) i **nigdzie nie pokazywane**. W `KafelekWizyty.tsx:60-64` został osierocony komentarz „D5: mechanik ma widzieć, czy jego zapis już dotarł" nad tablicą, która tego nie zawiera. |
| **R4** | `BEZPIECZENSTWO.md` D7: *„minimalna przerwa 20 s, cykl w tle co 2 minuty"* | Kod: `MIN_PRZERWA_SYNC_MS = 4_000`, `OKRES_SYNC_MS = 45_000`. |
| **R5** | `BEZPIECZENSTWO.md` C1 ✅: *„Przetestowane odtwarzanie"* | Kopia w ogóle się nie wykonuje (**K2**), więc odtwarzania nie było jak przetestować. |
| **R6** | Nagłówek `app/index.tsx`, punkt 5: *„nad listą stoi pasek z wiekiem danych i licznikiem zmian"* | Nieaktualne — jest tylko „Wszyscy klienci: N". |
| **R7** | Nagłówek `dane/sesja.ts` (A5): *„aplikacja blokuje się sama po 5 minutach bezczynności i po przejściu w tło"* | Nieaktualne i sprzeczne z `kontekst.tsx`, gdzie ta sama zmiana jest opisana jako świadomie cofnięta. Komentarz w `sesja.ts` trzeba doprowadzić do stanu faktycznego. |
| **R8** | Nagłówek `dane/baza.ts` (D5): *„z tego biorą się zegarek i ptaszek przy kafelkach"* | Zegarka i ptaszka nie ma (patrz R3). |
| **R9** | `rodo/klauzula-informacyjna.md` | Szablon z niewypełnionymi `[adres]`, `[NIP]`. Zgodne z oznaczeniem 👤 w `DO-ZROBIENIA-RECZNIE.md`, ale przed pierwszym klientem musi być uzupełnione. `umowy-powierzenia.md` ma DPA z Supabase oznaczone „☐ do podpisania". |

---

## 6. ✅ Co jest zrobione dobrze (nie zepsuć przy naprawach)

- **Deny-by-default w bazie zweryfikowane na żywo.** Security Advisor pokazuje
  wyłącznie 13× INFO `rls_enabled_no_policy` — zero błędów, zero ostrzeżeń.
  RLS włączone wszędzie, zero polityk, `anon` bez `USAGE` na schemacie.
- **Rozdział kluczy trzyma się.** `narzedzia/.env` nigdy nie było w repozytorium
  (sprawdzone przez całą historię `git rev-list --all`); żaden `sb_secret_`
  ani JWT z rolą inną niż `anon` nie występuje w żadnym commicie. Dwa niezależne
  bezpieczniki (`app.config.js` + `skanuj-sekrety.js`) są realne, nie deklaratywne.
- **`tsc --noEmit` przechodzi bez jednego błędu** przy `strict: true`.
- **Kolumnowy UPDATE (B1)** zrealizowany konsekwentnie na obu końcach —
  `tylkoZmienione()` na telefonie i `dozwolone_kolumny()` + dynamiczny SET
  w `zapisz_z_telefonu`. To jest trudne i zrobione poprawnie.
- **Idempotencja działa.** 110 wpisów w `operacje`, 0 kolizji, wszystkie ze
  statusem `ok`.
- **Kolejka nie gubi pozycji przy błędzie sieci** — `zanotujNieudanaProbe`
  zamiast usunięcia, potwierdzone kodem i logiką backoffu.
- **`pg_cron` retencji działa**: 3 uruchomienia, 0 nieudanych, ostatnie
  2026-09-01 03:17.
- **Uprawnienia administratora sprawdzane dwustopniowo** (funkcja brzegowa
  + `sprawdz_admina()` w każdej funkcji SQL), z realnym zabezpieczeniem przed
  zablokowaniem ostatniego administratora i unikalnym indeksem
  `idx_jeden_administrator` (potwierdzony w bazie).
- **Jedno wspólne otwarcie bazy** (`otwieranie`) — naprawa opisana w README
  jest w kodzie i jest poprawna.
- **Komentarze w kodzie są bardzo dobre** — tłumaczą *dlaczego*, nie *co*.
  Utrzymać ten poziom; jedyny problem to te, które zdążyły się zdezaktualizować
  (R6–R8).

---

## 7. Kolejność napraw

| # | Co | Dlaczego teraz | Szacunek |
|---|---|---|---|
| 1 | **K2** kopia zapasowa | Najtańsza naprawa o największym skutku. Dziś nie ma żadnej kopii poza Supabase. | 15 min + test odtworzenia |
| 2 | **K3 + W1 + W3** trwałość danych na telefonie | Jeden spójny pakiet: znacznik sync, kasowanie bazy, klucz idempotencji. Wszystkie trzy prowadzą do cichej utraty pracy mechanika. | pół dnia |
| 3 | **K4 + W2** uwierzytelnianie i parowanie | Fail-open przy odczycie Keychain + wyścig wydający martwy token. | pół dnia |
| 4 | **K1** izolacja warsztatów | Wymaga **decyzji produktowej**: jak telefon wskazuje warsztat przy zgłoszeniu. Do zrobienia przed drugim klientem, nie przed pierwszym. | 1 dzień + zmiana UX |
| 5 | **W4** widoczność kwarantanny, **W8/W9/W10** odporność ekranów i kolejki | Bez tego „✓ wszystko wysłane" bywa nieprawdą. | 1 dzień |
| 6 | **W5, W6, W7** porządek w bazie i retencji | Częściowo RODO, częściowo pułapki na przyszłość. | pół dnia |
| 7 | **R1–R9** doprowadzenie dokumentacji do stanu faktycznego | Albo dopisać brakujący pasek trybu podglądu i wskaźniki D4/D5, albo zdjąć ✅ z tych pozycji. Deklaracja bez pokrycia jest gorsza niż jawny brak. | 2 h |
| 8 | **S1–S4, S11** wydajność | Dziś 3 kartoteki — nic nie boli. Zrobić, zanim pierwszy warsztat przekroczy ~500 klientów. | 1 dzień |
| 9 | **N1–N16** | Przy okazji dotykania sąsiedniego kodu. | — |

---

## 8. Metodyka i granice tego audytu

**Co zrobiono:**
- Przeczytano cały kod źródłowy: 11 366 linii w `frontend/src`, `supabase/funkcje`,
  `supabase/migracje`, `narzedzia/`.
- `npx tsc --noEmit` w `frontend/` — bez błędów.
- Odczytowe zapytania do produkcyjnego Supabase: advisors (security + performance),
  lista migracji, schemat (`information_schema`), `cron.job` i `cron.job_run_details`,
  liczności tabel, analiza kluczy idempotencji, stan urządzeń.
- Jedno odczytowe zapytanie PostgREST (`GET`) potwierdzające **K2** na trzech
  tabelach.
- Syntetyczny benchmark zapytań z `repozytorium.ts` (better-sqlite3, baza
  w katalogu tymczasowym, skasowana po pomiarze) — do sekcji 3.
- Przeszukanie całej historii gita pod kątem sekretów.

**Czego nie zrobiono (świadomie):**
- **Nie wykonano żadnego zapisu** do bazy ani zmiany w plikach projektu.
  Jedyny nowy plik to ten raport. Aplikacja zachowuje się dokładnie tak samo
  jak przed audytem.
- Nie uruchomiono aplikacji ani nie zbudowano APK.
- Nie uruchomiono `npm run kopia` (utworzyłby plik z pełną bazą klientów
  na dysku) — zamiast tego odtworzono jego zapytanie odczytowo.

**Czego nie dało się sprawdzić bez urządzenia — do weryfikacji ręcznej:**
- Faktyczne działanie SQLCipher, Keystore/Keychain, biometrii i wyłączenia kopii
  do iCloud/Google Drive (punkty ⚙️ z `DO-ZROBIENIA-RECZNIE.md`) — to wymaga
  własnego builda i fizycznego telefonu.
- Zgodność `react-native-keyboard-controller@1.21.9` i `reanimated@4.5.1`
  w realnym buildzie EAS.
- Wpływ `experiments.reactCompiler: true` na wydajność list (S10) — trzeba
  zmierzyć, nie założyć.
- Zachowanie `expo-updates` (kanały OTA są skonfigurowane, ale aplikacja nigdzie
  nie sprawdza aktualizacji w kodzie — warto świadomie zdecydować, czy tak ma być).
