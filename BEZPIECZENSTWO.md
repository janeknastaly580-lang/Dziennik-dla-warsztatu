# Mapa ryzyk — co zostało zrobione i gdzie to znaleźć

Ten plik odpowiada punkt po punkcie na listę ryzyk A / B / C / D.
Dla każdego: **status**, **jak jest zrealizowane**, **gdzie w kodzie**.

Legenda statusów:

| Status | Znaczenie |
|---|---|
| ✅ | zrobione i sprawdzone w tym projekcie |
| ⚙️ | zrobione w kodzie, wymaga jednorazowej weryfikacji po zbudowaniu aplikacji |
| 👤 | wymaga działania człowieka — patrz [DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md) |
| ➖ | ryzyko zniknęło, bo system nie ma tej funkcji |

---

## Decyzja, która wycięła najwięcej ryzyk: brak zdjęć

System **nie robi, nie wysyła i nie przechowuje zdjęć ani żadnych plików** —
ani na telefonie, ani w bazie, ani w magazynie obiektów. Opis usterki jest
tekstem.

Znikają przez to w całości: **A7** (EXIF/GPS/wizerunki), **A8** (publiczny
bucket i pre‑signed URL), **B7** (rozjazd baza ↔ magazyn plików), **C3**
(utrata zdjęć), **D6** (zapełniona pamięć telefonu) i większość **D7**
(zalanie łącza). W kodzie: brak `expo-image-picker`, brak tabeli `pliki`,
uprawnienia do aparatu i galerii są jawnie zablokowane
([frontend/app.json](frontend/app.json), `android.blockedPermissions`
i [frontend/plugins/prywatnosc.js](frontend/plugins/prywatnosc.js)).

---

## Druga decyzja: nic nie jest hostowane po stronie dostawcy

Nie ma panelu administracyjnego na czyimkolwiek komputerze. Cały działający
system to Supabase i telefony. Zarządzanie dostępem żyje **w tej samej
aplikacji**, pod rolą `administrator`.

Znaczenie dla bezpieczeństwa:

- **Mniejsza powierzchnia ataku.** Nie ma serwera z kluczem `service_role`,
  który mógłby przypadkiem trafić na `0.0.0.0`, zostać zapomniany po
  aktualizacji systemu albo działać ze starą wersją zależności.
- **Nie ma hasła do panelu**, którego dałoby się wyłudzić albo odgadnąć.
  Uprawnienia administratora wiszą na roli w bazie i na tokenie urządzenia,
  a token unieważnia się jednym przyciskiem.
- **Dostawca nie ma wglądu w bieżącą pracę warsztatu.** Jego jedyny punkt
  styku to wystawienie jednorazowego kodu zaproszenia dla nowego warsztatu.

Uprawnienia administratora są sprawdzane **dwa razy, niezależnie**: w funkcji
brzegowej `admin` (rola z tokenu) oraz w każdej funkcji SQL
(`sprawdz_admina()`). Podmiana żądania z telefonu zwykłego mechanika nic nie
daje — sprawdzone na żywo: `{"kod":"BRAK_UPRAWNIEN"}`.

Zabezpieczenie przed zamknięciem się na zewnątrz: administrator nie może
zablokować samego siebie, odciąć własnego telefonu ani zablokować **ostatniego
czynnego administratora** warsztatu.

---

# A. Ryzyka wycieku danych

### A1 — Brak lub błędne RLS ✅

Model jest twardszy niż sama polityka RLS — **trzy niezależne warstwy**:

1. RLS włączone na **każdej** tabeli, **zero polityk** → odmowa dla wszystkich.
2. `REVOKE ALL` na tabelach, sekwencjach i funkcjach dla `anon` i `authenticated`
   oraz `ALTER DEFAULT PRIVILEGES`, żeby objęło to także przyszłe tabele.
3. `REVOKE ALL ON SCHEMA public FROM public` — rola `anon` nie ma nawet prawa
   wejścia do schematu. Nie zobaczy nazw tabel, nie mówiąc o danych.

Cały dostęp aplikacji idzie przez Edge Functions z `service_role`, które
sprawdzają token urządzenia.

- [supabase/migracje/0002_rls_deny_by_default.sql](supabase/migracje/0002_rls_deny_by_default.sql)
- [supabase/migracje/0005…](supabase/migracje) — uprawnienia `service_role`
- Zostawiona jest fabryczna siatka Supabase `rls_auto_enable()` (event trigger
  włączający RLS na każdej nowej tabeli); odebrano jej `EXECUTE` dla `anon`.

**Test praktyczny** — uruchamiaj po **każdej** zmianie schematu:

```bash
powershell -ExecutionPolicy Bypass -File supabase\testy\test-anon.ps1
```

Wynik na dziś: wszystkie 12 tabel i 4 funkcje → HTTP 401/404. Ręcznie:

```bash
curl "https://tpigqlvwjatlkhfqtlkt.supabase.co/rest/v1/klienci?select=*" -H "apikey: <ANON>"
```

zwraca `{"code":"42501","message":"permission denied for schema public"}`.

Security Advisor pokazuje 12 wpisów `rls_enabled_no_policy` na poziomie INFO —
to **zamierzony** stan „deny‑by‑default”, nie usterka.

### A2 — Klucz service_role w aplikacji lub repozytorium ✅ 👤

- W aplikacji mobilnej jest **wyłącznie** klucz `anon`
  ([frontend/src/dane/konfiguracja.ts](frontend/src/dane/konfiguracja.ts)).
- `service_role` żyje w dwóch miejscach: w sekretach Edge Functions (po stronie
  Supabase) i w `narzedzia/.env` na komputerze **dostawcy usługi** — nie
  warsztatu. `.env` jest w `.gitignore`.
- Skaner sekretów + hook `pre-commit`:
  [narzedzia/scripts/skanuj-sekrety.js](narzedzia/scripts/skanuj-sekrety.js)
  ```bash
  cd narzedzia && npm run skanuj -- --hook
  ```
  Wykrywa JWT z rolą `service_role`, klucze `sb_secret_…`, hasła w URL-ach
  Postgresa, klucze prywatne PEM, tokeny GitHub i AWS.

👤 Zainstaluj hook i **zrotuj klucz**, jeśli kiedykolwiek gdzieś go wkleiłeś.

### A3 — Zbyt szerokie reguły synchronizacji ✅

Reguły synchronizacji to **osobna warstwa**, niezależna od RLS — dokładnie tak,
jak mówi lista ryzyk. Telefon dostaje:

- kartoteki klientów swojego warsztatu (są małe, a mechanik musi mieć pełną
  wyszukiwarkę offline),
- wizyty z ostatnich **90 dni** (ustawialne per warsztat) **plus wszystkie
  nadal otwarte**, niezależnie od wieku.

Serwer: `pobierz_wizyty()` w
[0003_funkcje_synchronizacji.sql](supabase/migracje/0003_funkcje_synchronizacji.sql).
Telefon stosuje **tę samą regułę u siebie** — `posprzatajPozaOknem()` w
[frontend/src/dane/repozytorium.ts](frontend/src/dane/repozytorium.ts) kasuje
lokalnie zamknięte wizyty spoza okna. Okno zmienia się w kolumnie `okno_dni`
tabeli `warsztaty`, a telefony przyjmują nową wartość przy najbliższej
synchronizacji.

### A4 — Zgubiony, skradziony lub sprzedany telefon ✅ ⚙️

- **Szyfrowanie lokalnej bazy (SQLCipher).** Plik SQLite na telefonie jest
  zaszyfrowany. Klucza nie ma w kodzie: 256 bitów losowanych przy pierwszym
  uruchomieniu, zapisanych w Keychain / Keystore z flagą
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Skopiowanie pliku bazy ze znalezionego
  telefonu daje szyfrogram.
  Włączane opcją `useSQLCipher` wtyczki `expo-sqlite`
  ([frontend/app.json](frontend/app.json)); klucz i otwarcie bazy —
  [frontend/src/dane/baza.ts](frontend/src/dane/baza.ts).
  ⚙️ Działa **wyłącznie we własnym buildzie**, nie w Expo Go.
- **Auto-wipe:** telefon, który nie połączył się z serwerem przez
  *wygaśnięcie offline* (domyślnie 14 dni, ustawiane per warsztat), kasuje całą
  lokalną bazę. Skradziony telefon nigdy się nie połączy, więc wyczyści się sam.
  `sprawdzWygasniecieOffline()` w
  [frontend/src/dane/synchronizacja.ts](frontend/src/dane/synchronizacja.ts);
  sprawdzane przy starcie, przy powrocie z tła i przy każdej próbie synchronizacji.
- **Zdalne unieważnienie:** ekran „Dostęp" administratora → „Zablokuj telefon"
  albo „Zgubiony". Telefon przy najbliższym kontakcie dostaje `WYCZYSC`
  i kasuje dane.
- **Czyszczenie przy wylogowaniu** — razem z kluczem szyfrowania, więc
  pozostałości pliku na dysku są już nie do odczytania.
- **Blokada po 10 nieudanych próbach hasła** — kasuje lokalną bazę.
- **Wąskie okno synchronizacji (A3)** ogranicza to, co w ogóle jest do stracenia.

👤 Systemowe szyfrowanie pamięci i ochrona Keystore działają **tylko wtedy, gdy
telefon ma ustawiony PIN lub odcisk palca** — wymuś to na telefonach służbowych.

### A5 — Aplikacja otwarta na niezablokowanym telefonie ✅

Własna blokada aplikacji, niezależna od blokady systemowej:

- hasło (dowolne — mechanik wymyśla je sam) albo odcisk palca / Face ID,
- **automatyczne zablokowanie po 5 minutach bezczynności**,
- **natychmiastowe zablokowanie przy przejściu aplikacji w tło**,
- przycisk „Zablokuj aplikację teraz”.

[frontend/src/dane/kontekst.tsx](frontend/src/dane/kontekst.tsx),
[frontend/src/komponenty/EkranBlokady.tsx](frontend/src/komponenty/EkranBlokady.tsx).

### A6 — Były pracownik z aktywną sesją ✅

Procedura offboardingu to **jeden przycisk w aplikacji administratora**
(ekran „Dostęp” → „Odbierz dostęp”). Skutek natychmiastowy:

- konto mechanika oznaczone jako zablokowane,
- wszystkie jego telefony dostają `WYCZYSC` przy najbliższym kontakcie i kasują
  lokalną bazę,
- token nie daje już dostępu do żadnych danych,
- wpis w dzienniku działań administratora (kto, kiedy, kogo).

Jeśli telefon jest offline — domyka to auto‑wipe z A4.
`admin_zablokuj_mechanika()` w
[0011_funkcje_administratora.sql](supabase/migracje/0011_funkcje_administratora.sql)
sprawdza uprawnienia niezależnie od funkcji brzegowej i pilnuje, żeby warsztat
nie został bez żadnego czynnego administratora.

### A7 — Metadane EXIF i GPS w zdjęciach ➖

Nie ma zdjęć. Aparat i galeria są jawnie zablokowane w konfiguracji aplikacji.

### A8 — Publiczny bucket albo długo żyjące pre‑signed URL ➖

Nie ma magazynu plików. Supabase Storage nie jest w tym projekcie używany.

### A9 — Phishing i słabe hasła ✅

Mechanik **nie ma hasła do systemu** — nie ma czego wyłudzić. Dostęp przyznaje
administrator zdalnie, jednorazowo, przypisując ośmioznakowy kod z ekranu
telefonu do konkretnego człowieka. Hasło, które mechanik ustawia, to lokalna
blokada aplikacji: nie otwiera niczego w internecie, więc jego wyciek nie daje
dostępu do bazy. Sam kod parowania też nie jest sekretem — bez zgody
administratora i bez sekretu zapisanego w Keychain nic nie znaczy.

Administrator wchodzi do aplikacji tak samo jak mechanik — nie ma osobnego
panelu ani osobnego hasła. Jego dodatkowe uprawnienia wiszą na roli w bazie
i tokenie urządzenia, a nie na haśle, które dałoby się wyłudzić.

### A10 — Wyniesienie danych przez pracownika ✅

- **Nie ma i nie będzie funkcji „eksportuj wszystko”** w aplikacji mobilnej —
  napisane wprost w [frontend/src/app/ustawienia.tsx](frontend/src/app/ustawienia.tsx).
- **Dziennik dostępu:** każde otwarcie kartoteki klienta i zgłoszenia trafia do
  tabeli `dziennik_dostepu` (kto, kiedy, co). Kolejkowany lokalnie, więc działa
  też offline. Podgląd: tabela `dziennik_dostepu` w panelu Supabase.
- Wąskie okno synchronizacji (A3) ogranicza zasięg tego, co pracownik ma w ręku.
- 👤 Umowa o zachowaniu poufności z mechanikami — poza kodem.

### A11 — Dane osobowe w logach i raportach błędów ✅

- Edge Functions logują **wyłącznie kody zdarzeń i liczby** — nigdy treści
  żądań ani danych klienta (`log()` w
  [supabase/funkcje/sync/index.ts](supabase/funkcje/sync/index.ts)).
- Funkcja `admin` loguje wyłącznie kod zdarzenia (`przyznanie_dostepu`,
  `blokada_mechanika`) — bez imion i bez identyfikatorów w treści logu.
- Dziennik działań administratora w bazie zapisuje UUID-y, nie dane osobowe.
- W projekcie nie ma Sentry ani innego crash reportingu. 👤 Jeśli będziesz go
  dodawać, wyłącz wysyłanie ciał żądań i stanu aplikacji.

### A12 — Automatyczny backup lokalnej bazy do iCloud / Google Drive ✅ ⚙️

Wtyczka [frontend/plugins/prywatnosc.js](frontend/plugins/prywatnosc.js):

- **Android:** `android:allowBackup="false"`, `android:fullBackupContent="false"`
  oraz plik reguł `dataExtractionRules` wykluczający wszystko z kopii w chmurze
  i z przenoszenia między urządzeniami. **Sprawdzone** — `expo config
  --type introspect` pokazuje te atrybuty w manifeście.
- **iOS:** wtyczka dopisuje do `AppDelegate` ustawienie
  `isExcludedFromBackupKey` na katalogu `Documents` (tam mieszka plik SQLite).
- Klucze w Keychain mają `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, więc nie wędrują
  z kopią nawet gdyby coś przeszło.

⚙️ Wtyczka działa przy `expo prebuild` / `eas build` — **nie działa w Expo Go**.
Zweryfikuj po zbudowaniu, nie zakładaj (instrukcja w
[DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md)).

### A13 — Telefony prywatne mechaników (BYOD) 👤

To decyzja organizacyjna, nie techniczna. Rekomendacja: telefony służbowe.
Detekcja root/jailbreak nie jest zaimplementowana — na zrootowanym telefonie
każde zabezpieczenie po stronie aplikacji da się obejść, więc dawałaby złudne
poczucie bezpieczeństwa. Realną obroną są tu A3 (mało danych na telefonie),
A4 (auto‑wipe) i A6 (odcięcie na żądanie).

### A14 — Łańcuch sub‑procesorów i CLOUD Act ✅ 👤

- Projekt Supabase stoi w regionie **eu-central-1 (Frankfurt)**.
- W architekturze **nie ma** Cloudflare, PowerSync ani żadnego innego
  dostawcy — łańcuch sub‑procesorów to wyłącznie Supabase (i AWS pod spodem).
  To o dwóch dostawców mniej niż w pierwotnym planie.
- 👤 Podpisz DPA z Supabase i przyjmij ryzyko rezydualne świadomie.

### A15 — Braki formalne RODO ✅ 👤

Szablony do uzupełnienia leżą w katalogu [rodo/](rodo/):

- `rejestr-czynnosci.md` — rejestr czynności przetwarzania,
- `klauzula-informacyjna.md` — do wywieszenia/wręczenia klientom warsztatu,
- `procedura-naruszenia.md` — zgłoszenie do UODO w 72 h, spisane **zanim**
  będzie potrzebne,
- `umowy-powierzenia.md` — lista DPA do podpisania.

👤 Uzupełnij dane firmy i podpisz DPA z Supabase.

---

# B. Ryzyka niepoprawnej bazy danych

### B1 — Nadpisanie cudzej zmiany przy pełnym UPDATE wiersza ✅

Telefon wysyła **wyłącznie kolumny, które faktycznie zmienił**.
`tylkoZmienione()` w
[frontend/src/dane/repozytorium.ts](frontend/src/dane/repozytorium.ts) porównuje
nowe wartości ze stanem lokalnym i wkłada do kolejki tylko różnicę. Serwer
buduje `UPDATE` dynamicznie z tego zestawu kolumn
(`zapisz_z_telefonu()` w [0003](supabase/migracje/0003_funkcje_synchronizacji.sql)).

**Sprawdzone na żywo:** wizyta z `opis='opis pierwotny'`, `priorytet='wysoki'`;
push zmieniający tylko `status` → po zapisie `status='w_trakcie'`,
`opis` i `priorytet` nietknięte.

### B2 — DELETE kontra UPDATE ✅

Nigdzie nie ma fizycznego `DELETE` z aplikacji ani z Edge Function — operacja
`usun` ustawia `usuniete_o = now()`. Fizycznie kasuje wyłącznie zadanie
serwerowe po okresie retencji (domyślnie 365 dni, ustawialne per warsztat):
`zadanie_retencji()` w
[0004_retencja_i_zadania.sql](supabase/migracje/0004_retencja_i_zadania.sql),
uruchamiane codziennie o 3:17 przez `pg_cron`.

### B3 — Duplikat wizyty lub klienta ✅

Trzy poziomy, bo — jak mówi lista ryzyk — nic się nie nadpisuje, więc system
sam z siebie nie zgłosi błędu:

1. **Ostrzeżenie zanim duplikat powstanie**, działające offline: formularz
   nowego klienta na żywo sprawdza numer telefonu (znormalizowany do 9 cyfr,
   więc `+48 601-234-567` = `601 234 567` = `0048601234567`); formularz nowej
   wizyty ostrzega, jeśli **to samo auto ma otwartą wizytę z ostatnich 48 h**.
2. **Wykrywanie po stronie serwera:** przy zapisie `zapisz_z_telefonu()`
   dopisuje podejrzane pary do `mozliwe_duplikaty` — do przejrzenia w panelu
   Supabase, gdy trzeba wyjaśnić bałagan w kartotekach.
3. **Narzędzie do posprzątania:** w profilu klienta pojawia się propozycja
   „Scal kartoteki” — wizyty przechodzą do starszej kartoteki, nowsza zostaje
   zamknięta, operacja jedzie na serwer jako `scal`.

**Sprawdzone na żywo:** oba typy duplikatów wykryte i zapisane.

### B4 — Liczniki i pola agregujące ✅

W bazie **nie ma ani jednej kolumny agregującej**. Wszystkie liczniki
(„3 otwarte usterki”, liczba aut, suma kosztów) są liczone `COUNT()`/`SUM()`
przy odczycie — i po stronie serwera, i w lokalnej bazie telefonu
(`listaKlientow()`, `profilKlienta()`).

### B5 — Numeracja sekwencyjna zleceń ✅

- Klucze główne to **UUID nadawane na telefonie** (`Crypto.randomUUID()`).
- **Numer roboczy** powstaje na telefonie z prefiksem warsztatu:
  `W1-2026-0001`. Mechanik ma czym nazwać zlecenie od razu, offline.
- **Numer oficjalny** nadaje wyłącznie serwer przy pierwszym udanym zapisie —
  `nadaj_numer()` z licznikiem per warsztat i rok: `W1/2026/0001`.
  Dwa warsztaty offline nie mogą wygenerować tego samego numeru, bo żaden
  telefon numeru oficjalnego nie nadaje.

### B6 — Przestawiony zegar telefonu ✅

Każdy rekord ma `zrobione_o` (zegar telefonu) i `zapisane_o` (zegar Postgresa).
Trigger `trg_znaczniki()` przycina: `zrobione_o = LEAST(zrobione_o, now())`.
**Sprawdzone:** wizyta wysłana z datą +3 dni w przyszłość została przycięta.

### B7 — Rozjazd między bazą a magazynem zdjęć ➖

Nie ma magazynu plików.

### B8 — Zablokowana kolejka uploadu ✅

To ryzyko potraktowane najpoważniej — trzy niezależne zabezpieczenia:

1. **Backend nigdy nie zwraca trwałego 4xx dla błędu danych.**
   `zapisz_z_telefonu()` łapie **każdy** wyjątek SQL, odkłada rekord do tabeli
   `kwarantanna` i kończy się **poprawnie**. Edge Function ma na to jeszcze
   drugą siatkę: `try/catch` wokół wywołania RPC, też kończący kwarantanną.
   Awaria serwera (5xx) jest zwracana jako `503 {ponow:true}` — telefon
   ponawia, nic nie wyrzuca.
2. **Kolejka na telefonie nigdy nie stoi za jedną pozycją.** Pozycja znika
   z kolejki, gdy serwer *potwierdzi jej przyjęcie* — także wtedy, gdy odłożył
   ją do kwarantanny. Błąd sieci zostawia ją na miejscu.
   [frontend/src/dane/kolejka.ts](frontend/src/dane/kolejka.ts)
3. **Widoczność:** licznik „N czeka na wysłanie” na każdym ekranie,
   ostrzeżenie, gdy najstarsza pozycja czeka ponad dobę. Po stronie serwera
   funkcja `raport_synchronizacji()` pokazuje, który telefon milczy dłużej
   niż dobę.

**Sprawdzone na żywo:** w jednej paczce wysłano poprawnego klienta, poprawną
wizytę, zmianę statusu na wartość spoza słownika i zapis do nieistniejącej
tabeli. Wynik: dwa `ok`, dwa `kwarantanna`, kolejka pusta, HTTP 200.

### B9 — Naruszenie klucza obcego przy zapisie offline ✅

Rozwiązane automatycznie przez B2 (wizyta nigdy nie znika fizycznie, więc klucz
obcy się zgadza) plus regułę z B8 (przyjmij i odłóż zamiast odrzucać).
Dodatkowo operacja `usun` na nieistniejącym wierszu **nie jest błędem** —
rekord może jeszcze nie dojechać z innego telefonu.

### B10 — Zmiana schematu przy starych wersjach aplikacji ✅

- **Migracje wyłącznie addytywne** — nowe kolumny nullable z wartością
  domyślną. Zasada zapisana w nagłówkach migracji i w lokalnej bazie telefonu
  ([frontend/src/dane/baza.ts](frontend/src/dane/baza.ts), tablica `MIGRACJE`
  z `PRAGMA user_version`).
- **Wersja schematu w każdym żądaniu** (`wersja_schematu`), sprawdzana przez
  Edge Function.
- Aplikacja zbyt stara dostaje `WYMAGANA_AKTUALIZACJA` **przy pobieraniu**, ale
  jej **zapisy są nadal przyjmowane** — nikt nie traci pracy przez to, że nie
  zaktualizował aplikacji. Mechanik widzi wyraźny pasek z prośbą o aktualizację.

### B11 — Ten sam mechanik na dwóch urządzeniach ✅

Obowiązują te same reguły co przy dwóch mechanikach (B1, B12, B3) — nic nie
jest zakładane o unikalności urządzenia. Ekran „Dostęp” pokazuje wszystkie
telefony przypisane do mechanika i pozwala każdy z osobna zablokować
lub wyrejestrować.

### B12 — Duplikaty z ponowień ✅

- Identyfikator rekordu powstaje **na telefonie przy tworzeniu** i jest ten sam
  przy każdym ponowieniu.
- Każda pozycja kolejki ma **klucz idempotencji** (`urządzenie:pozycja`).
  Serwer zapamiętuje wynik w tabeli `operacje` i przy powtórce oddaje
  **zapamiętany wynik**, nie wykonując operacji drugi raz.
- `INSERT … ON CONFLICT (id) DO NOTHING` jako dodatkowe zabezpieczenie.

**Sprawdzone na żywo:** powtórzony push z tym samym kluczem i inną treścią
zwrócił `{"status":"ok","powtorka":true}`, a dane w bazie **nie zmieniły się**.

### B13 — Brak walidacji po stronie serwera ✅

Każdy zapis z telefonu jest traktowany jako niezaufany, na trzech poziomach:

1. Edge Function: lista dozwolonych tabel, operacji i kolumn, sprawdzenie
   formatu UUID, przycinanie długości, limit 200 zmian na żądanie.
2. Funkcja SQL: `dozwolone_kolumny()` — nawet gdyby Edge Function zawiodła,
   baza przyjmie wyłącznie kolumny z listy.
3. Postgres: ograniczenia `CHECK` na długości, słowniki (`status`, `priorytet`,
   `rola`, `platforma`), zakresy (`przebieg`, `koszt`, `okno_dni`), klucze obce.

---

# C. Ryzyka utraty danych

### C1 — Uszkodzenie lub skasowanie bazy na serwerze ✅ 👤

- **Własna kopia u innego podmiotu:** `cd narzedzia && npm run kopia` zrzuca
  wszystkie tabele do jednego pliku JSON w katalogu `kopie/`.
- **Przetestowane odtwarzanie:** `npm run przywroc -- <plik>` (z `--na-sucho`
  do samego sprawdzenia). Odtwarzanie jest idempotentne — upsert po kluczu
  głównym, nic nie kasuje.
- 👤 Sprawdź w panelu Supabase, czy codzienne kopie są włączone, rozważ PITR
  i **przetestuj odtworzenie na pustym projekcie, zanim będzie potrzebne**.
  Kopia nieprzetestowana to nie kopia.
- 👤 Ustaw cotygodniowe przypomnienie o `npm run kopia` i **wynoś plik poza ten
  komputer i poza Supabase**.

### C2 — Utrata dostępu do konta Supabase 👤

- 👤 Włącz MFA na koncie Supabase.
- 👤 Trzymaj aktualną kartę płatniczą.
- ✅ Kopie z C1 są w standardowym JSON‑ie z pełnym schematem w
  `supabase/migracje/` — odtworzenie na dowolnym Postgresie to godzina pracy:
  odpal migracje, potem `npm run przywroc`.

### C3 — Utrata zdjęć z R2 ➖

Nie ma zdjęć ani magazynu obiektów.

---

# D. Ryzyka spowolnienia pracy przez brak internetu

### D1 — Wylogowanie przez wygasły token ✅ — **ryzyko usunięte u źródła**

Zamiast walczyć z odświeżaniem sesji, projekt **nie używa Supabase Auth dla
mechaników**. Telefon dostaje **opaque token urządzenia, który nie ma daty
ważności i nigdy nie jest odświeżany**. Nie ma czego odświeżyć, więc brak sieci
nie ma jak nikogo wylogować. Sesję unieważnia wyłącznie administrator.

Do tego:

- ekrany czytają **wyłącznie z lokalnej bazy SQLite** — nigdy z sieci,
- o tym, co pokazać (parowanie / hasło / blokada / aplikacja), decyduje
  wyłącznie zawartość telefonu ([frontend/src/dane/kontekst.tsx](frontend/src/dane/kontekst.tsx)),
- nieudana synchronizacja **nigdy** nie czyści sesji ani kolejki; jedyny
  wyjątek to jawna odpowiedź serwera „zablokowane / wyczyść”,
- ekran odblokowania nie dotyka sieci.

👤 **Test akceptacyjny przed wdrożeniem** (opisany w
[DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md)): zaloguj się, tryb
samolotowy, zabij aplikację, poczekaj 2 h, otwórz. Musisz zobaczyć ekran hasła
i po jego podaniu **wszystkie dane**. Ekran parowania = nie wdrażasz.

### D2 — Pierwsze uruchomienie wymaga internetu ✅ (ograniczenie przyjęte)

Aplikacja mówi to wprost na ekranie parowania: „Do pierwszego uruchomienia
potrzebny jest internet. Później aplikacja działa także bez zasięgu”.
👤 Wdrażaj mechaników przy działającym łączu.

### D3 — Pierwsza pełna synchronizacja jest ciężka ✅

Wąskie okno (A3) drastycznie to skraca — na telefon idzie 90 dni historii,
nie pięć lat. Pobieranie stronami po 500 wierszy z kursorem, więc przerwane
połączenie nie zaczyna od zera. 👤 Pierwszą synchronizację zrób po Wi‑Fi.

### D4 — Mechanik nie wie, że patrzy na stare dane ✅

Stały pasek nad każdą listą:
„dane aktualne” / „dane sprzed 14 min” / „dane sprzed 3 dni”, z kolorem
(zielony → bursztynowy → czerwony) i kropką stanu. Dotknięcie paska =
natychmiastowa synchronizacja. Pociągnięcie listy w dół robi to samo.
[frontend/src/komponenty/PasekSynchronizacji.tsx](frontend/src/komponenty/PasekSynchronizacji.tsx)

### D5 — Mechanik nie wie, czy jego zapis dotarł ✅

- Licznik „⏱ N czeka” / „✓ wysłane” na pasku, na każdym ekranie.
- **Znacznik przy każdym rekordzie** — kafelek klienta i kafelek wizyty
  pokazują „⏱ czeka na wysłanie”, dopóki zmiana nie dotrze na serwer.
- Na ekranie zgłoszenia dodatkowo pełne zdanie wyjaśniające, że dane są
  bezpiecznie zapisane na telefonie.
- Ostrzeżenie, gdy najstarsza pozycja czeka ponad dobę.

To bezpośrednio ogranicza B3 — mechanik nie wpisuje tego samego drugi raz.

### D6 — Zapełniona pamięć telefonu ➖

Nie ma zdjęć, więc kolejka to sam tekst. Baza jest dodatkowo przycinana do okna
90 dni.

### D7 — Zalew łącza po powrocie sieci ✅

- Wysyłka paczkami po 50 zmian, maksymalnie 20 paczek na cykl.
- Minimalna przerwa 20 s między automatycznymi cyklami, cykl w tle co 2 minuty.
- Tylko jedna synchronizacja naraz (`stan.trwa`).
- Najpierw wysyłka własnych zmian, potem pobieranie — dane tekstowe mają
  pierwszeństwo, bo innych nie ma.

### D8 — Aplikacja zabita w tle podczas wysyłki ✅

Kolejka jest tabelą SQLite — przeżywa restart, crash i wyłączenie telefonu.
Wysyłka wznawia się przy następnym otwarciu aplikacji i przy każdym powrocie
z tła (`AppState`). Zadanie w tle (`expo-background-task`) nie jest dodane —
przy kolejce tekstowej i cyklu co 2 minuty w trakcie pracy nie daje realnej
korzyści, a dokłada uprawnień i zużycia baterii.

### D9 — Awaria po stronie Supabase ✅

Tu offline‑first pokazuje przewagę: praca idzie dalej, zmiany się kolejkują,
po powrocie usługi wszystko dochodzi. Awaria (5xx) jest zwracana jako
`{ponow:true}` i nigdy nie kasuje kolejki.
👤 Obserwuj [status.supabase.com](https://status.supabase.com).

### D10 — Rozrastająca się lokalna baza spowalnia aplikację ✅

- Indeksy na kolumnach używanych do wyszukiwania i sortowania — w Postgresie
  i w lokalnym SQLite.
- Okno 90 dni (A3) trzyma lokalną bazę w ryzach na stałe: zamknięte wizyty
  starsze niż okno są kasowane lokalnie po każdej udanej synchronizacji
  (z zabezpieczeniem: rekord z niewysłanymi zmianami nigdy nie zostanie
  skasowany).

---

## Kolejność wdrażania — pierwsze dziesięć

| # | Ryzyko | Status |
|---|---|---|
| 1 | A1 — RLS + test kluczem anon | ✅ zrobione i **sprawdzone** |
| 2 | D1 — sesja offline | ✅ zrobione, 👤 test z trybem samolotowym po Twojej stronie |
| 3 | A3 — wąskie reguły synchronizacji | ✅ zrobione |
| 4 | B8 — kwarantanna zamiast 4xx | ✅ zrobione i **sprawdzone** |
| 5 | B2 — soft delete wszędzie | ✅ zrobione i **sprawdzone** |
| 6 | A2 — zero service_role w aplikacji + skaner | ✅ zrobione, 👤 zainstaluj hook |
| 7 | A12 — wyłączenie kopii zapasowych | ✅ Android sprawdzony, ⚙️ iOS do weryfikacji po buildzie |
| 8 | B1 — UPDATE tylko na zmienionych kolumnach | ✅ zrobione i **sprawdzone** |
| 9 | A4 — szyfrowanie lokalnej bazy + auto‑wipe po 14 dniach | ✅ zrobione (SQLCipher włączony) |
| 10 | C1 — własna kopia u innego dostawcy | ✅ narzędzia gotowe, 👤 uruchom i przetestuj odtworzenie |
