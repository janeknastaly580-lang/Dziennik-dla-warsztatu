# System warsztatu samochodowego

Aplikacja mobilna dla mechaników, działająca **bez internetu**, oraz panel
administratora do zarządzania dostępem. Dane leżą w bazie Supabase w regionie
UE; telefon trzyma własną kopię roboczą i pracuje na niej.

**System nie przechowuje zdjęć** — ani na telefonie, ani w chmurze. To
świadoma decyzja projektowa, która usuwa cały łańcuch ryzyk (metadane GPS,
wizerunki osób w tle, publiczne magazyny plików, rozjazd bazy z plikami,
zapchana pamięć telefonu).

```
Nowy folder (5)/
├── frontend/    aplikacja mobilna (React Native + Expo) - offline-first
├── backend/     panel administratora (Node + Express) - działa na 127.0.0.1
├── supabase/    migracje bazy, funkcje brzegowe, test bezpieczeństwa
├── rodo/        rejestr czynności, klauzula informacyjna, procedura naruszenia
└── dane/        stara, lokalna baza SQLite (do jednorazowej migracji)
```

📄 **[BEZPIECZENSTWO.md](BEZPIECZENSTWO.md)** — mapa wszystkich ryzyk A/B/C/D:
co zrobione, gdzie w kodzie, co sprawdzone.
📄 **[DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md)** — czynności, których
nie da się wykonać za Ciebie.

---

## Jak to działa

```
   TELEFON MECHANIKA                CHMURA (Supabase, Frankfurt)
   ┌────────────────────┐          ┌──────────────────────────────┐
   │ ekrany             │          │  Edge Function `sync`        │
   │   ↕                │          │   - sprawdza token urządzenia│
   │ lokalna baza       │◄───────► │   - wąskie okno danych       │
   │ SQLite             │  token   │   - kwarantanna zamiast 4xx  │
   │   ↕                │urządzenia│              ↕               │
   │ kolejka wysyłkowa  │          │  Postgres: RLS bez polityk,  │
   └────────────────────┘          │  klucz anon nie widzi nic    │
                                   └──────────────────────────────┘
                                                  ▲
   KOMPUTER W WARSZTACIE                          │ service_role
   ┌────────────────────┐                         │
   │ panel administratora  ──────────────────────┘
   │ (tylko 127.0.0.1)  │
   └────────────────────┘
```

Trzy rzeczy, które wynikają wprost z tego rysunku:

1. **Ekrany nigdy nie czytają z sieci.** Czytają z lokalnej bazy. Brak zasięgu
   nie spowalnia pracy i nie wylogowuje mechanika.
2. **Klucz wbudowany w aplikację nie daje dostępu do niczego.** Wszystko idzie
   przez funkcję `sync`, która sprawdza imienny token urządzenia.
3. **Klucz `service_role` nigdy nie opuszcza serwera.** Jest w sekretach
   Supabase i w `backend/.env` — nie ma go w paczce aplikacji.

---

## Wejście mechanika do aplikacji

Mechanik **nie zna żadnego hasła do systemu** — takiego hasła po prostu nie ma.

```
1. Mechanik otwiera aplikację         →  na ekranie pojawia się KOD: P85WPWLR
2. Podaje kod administratorowi           (telefonicznie, SMS-em, jakkolwiek)
3. Administrator w panelu:               "Dostęp" → wpisz kod → wybierz mechanika
                                          → Przyznaj dostęp
4. Telefon w ciągu kilku sekund       →  "Ustaw swoje hasło"
5. Mechanik wpisuje DOWOLNE hasło     →  wchodzi do aplikacji
```

Od tej chwili wchodzi tym hasłem albo odciskiem palca. Kod parowania jest
jednorazowy i sam z siebie nic nie daje — dostęp przyznaje administrator,
a token odbiera wyłącznie ten telefon, który ma sekret w Keychain/Keystore.

**Administrator może w każdej chwili:**

| Akcja w panelu | Skutek na telefonie |
|---|---|
| Każ ustawić nowe hasło | przy najbliższym uruchomieniu prośba o nowe hasło, dane zostają |
| Zablokuj telefon | dostęp odcięty, lokalna baza skasowana |
| Zablokuj dostęp mechanikowi | to samo, ale na **wszystkich** jego telefonach |
| Odblokuj | telefon wraca do pracy bez ponownego parowania |
| Wyrejestruj (zgubiony) | sesja unieważniona na stałe, wymagane parowanie od nowa |

Jeśli telefon jest offline i już nigdy się nie połączy — **skasuje dane sam**
po 14 dniach bez synchronizacji (wartość ustawialna w panelu).

---

## Szybki start

### 1. Baza (już gotowa)

Projekt Supabase `Dziennik-dla-warsztatów-serwer` jest skonfigurowany: schemat,
RLS, funkcje brzegowe i zadanie retencji działają. Migracje leżą
w `supabase/migracje/` — trzymaj je w repozytorium, to jest źródło prawdy
o schemacie.

### 2. Panel administratora

```bash
cd backend
npm install
```

Uzupełnij `backend/.env` (wzór w `.env.example`) — brakuje tylko klucza
`SUPABASE_SERVICE_ROLE_KEY`, patrz [DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md).

```bash
npm start
```

Otwórz <http://127.0.0.1:4000>. Panel jest widoczny **wyłącznie z tego
komputera** — stoi za nim klucz omijający wszystkie zabezpieczenia bazy.

### 3. Aplikacja mobilna

```bash
cd frontend
npm install
npm start
```

**Do prób** wystarczy Expo Go (kod QR). **Do pracy w warsztacie potrzebny jest
własny build** (`eas build`) — dopiero on wyłącza kopie zapasowe do iCloud
i Google Drive (ryzyko A12). W Expo Go ta wtyczka nie działa.

---

## Panel administratora

| Zakładka | Co pokazuje |
|---|---|
| **Stan** | liczniki bazy, lista telefonów, kolumna „bez sync (h)” — sygnał, że telefon pracuje, ale nic nie dosyła |
| **Dostęp** | telefony czekające na zgodę, przyznawanie dostępu, blokady, lista mechaników |
| **Kwarantanna** | zapisy, których baza nie przyjęła. Pusta lista = stan prawidłowy |
| **Duplikaty** | kartoteki i zgłoszenia założone niezależnie przez dwa telefony offline |
| **Dziennik** | kto, kiedy, którą kartotekę otwierał + dziennik działań administratora |
| **Ustawienia** | okno synchronizacji, retencja, wygaśnięcie offline, nowe warsztaty |

Polecenia pomocnicze:

```bash
npm run kopia                      # własna kopia zapasowa do kopie/*.json
npm run przywroc -- kopie/x.json   # odtworzenie (--na-sucho = tylko sprawdzenie)
npm run skanuj -- --hook           # skaner sekretów + hook pre-commit
npm run migruj -- --zapisz         # jednorazowy import starej bazy SQLite
```

---

## Aplikacja mobilna — interfejs

Cały interfejs jest projektowany pod ekran telefonu w proporcjach około 9:16 —
wysoki i wąski. Odpowiada za to `frontend/src/uklad.ts` oraz komponent
`RamkaTelefonu`, który owija całą nawigację. Na tablecie i w przeglądarce
aplikacja rysuje się wewnątrz obudowy telefonu; na telefonie ramka znika.

**Skala** — wszystkie odstępy, czcionki i zaokrąglenia są liczone względem
telefonu referencyjnego 360 × 640 dp przez funkcję `s()`, z ograniczeniem
0.85–1.3. Elementy zajmujące stałą część wysokiego ekranu używają `wys(procent)`:

| Element | Reguła | iPhone SE | Pixel 7 | iPad |
|---|---|---|---|---|
| Duży przycisk „DODAJ” | 11% wysokości (84–120) | 84 | 101 | 113 |
| Kafelek nienaprawionej usterki | 16% wysokości (min 132) | 132 | 146 | 164 |
| Kafelek naprawionej usterki | cel dotyku 44 dp | 46 | 50 | 57 |

Proporcja „duży kafelek do małego” trzyma się na poziomie **ok. 2.9×** na
każdym urządzeniu — kluczowe wyróżnienie usterek nienaprawionych nie rozjeżdża
się na innym telefonie. Każdy element dotykowy ma co najmniej 44 dp.
Orientacja jest zablokowana na pionową.

### Widok główny — lista klientów

| Wymaganie | Realizacja |
|---|---|
| Pełna lista klientów od razu po wejściu | odczyt z lokalnej bazy, natychmiastowy, także bez zasięgu |
| Pole wyszukiwania nad listą | `PoleWyszukiwania` w nagłówku ekranu |
| Filtr **na żywo** ukrywający niepasujących | filtrowanie lokalne w `useMemo` — reaguje na każdą literę |
| Przycisk „Dodaj” widoczny, ale poza centrum | pigułka **„+ Dodaj”** w prawym górnym rogu paska nawigacji |
| Wiek danych i stan wysyłki | **pasek synchronizacji** nad listą (nowość) |

Wyszukiwarka ignoruje polskie znaki i spacje, więc `zielinska` znajdzie
`Zielińska`, a `kr12345` znajdzie auto opisane jako `KR 12345`. Przeszukiwane
są: nazwa, telefon, e‑mail, adres oraz opisy aut z wizyt tego klienta.

Plakietka **„N otwartych usterek”** prowadzi na ekran zbiorczy.

### Otwarte usterki

Zbiorcza lista niezamkniętych zgłoszeń ze **wszystkich** kartotek. Dwa przyciski
filtrujące („W trakcie”, „Nie naprawione”) z licznikami; ponowne dotknięcie
aktywnego przycisku zdejmuje filtr. Kolejność: **priorytet malejąco**, przy
równym priorytecie nienaprawione przed „w trakcie”, na końcu nowsza data.

### Profil klienta

Na samej górze duży przycisk **„DODAJ”** (nowa wizyta), poniżej dane klienta,
zakładki filtrowania po aucie i pełna historia. Zakładki powstają z unikalnych
opisów aut wpisanych przy wizytach — nie ma kartoteki pojazdów.

Jeśli inny telefon założył kartotekę z tym samym numerem telefonu, na górze
pojawia się propozycja **scalenia**.

### Kafelki historii

| | Nienaprawione / w trakcie | Naprawione |
|---|---|---|
| Wysokość | 16% wysokości ekranu, min. 132 dp | cel dotyku 44 dp (~2.9× mniej) |
| Tło | kolorowe (czerwone / bursztynowe) | białe, stonowane |
| Lewa krawędź | gruba, 8 px, w kolorze statusu | brak |
| Cień | mocny | brak |
| Opis usterki | widoczny (do 3 linii) | ukryty |
| Dodatki | odznaka statusu, priorytet, przebieg, **znacznik „⏱ czeka na wysłanie”** | kropka statusu i jedna linia podpisu |

### Auto jako swobodny tekst

Nie ma osobnej kartoteki pojazdów. Formularz nowego zgłoszenia ma trzy okienka
plus wybór priorytetu:

| Pole | Wymagane | Uwagi |
|---|---|---|
| **Auto** | nie | Swobodny tekst, bez walidacji. Może być marka i rejestracja, może być „tańsze auto pana Adama”. |
| **Tytuł wizyty** | tak | Krótka nazwa zgłoszenia. |
| **Opis** | nie | Szczegóły usterki. |

Statusu **nie wybiera się przy dodawaniu** — każde nowe zgłoszenie startuje
jako `nienaprawione`, a dalej idzie ścieżką
`nienaprawione → w_trakcie → naprawione`.

Jeśli to samo auto ma już otwartą wizytę z ostatnich 48 godzin, formularz
o tym mówi **zanim** powstanie drugie zgłoszenie tej samej usterki.

---

## Struktura plików

```
frontend/
├── app.json                konfiguracja Expo (adres chmury, klucz publiczny)
├── plugins/prywatnosc.js   A12: wyłączenie kopii do iCloud i Google Drive
└── src/
    ├── dane/               ← WARSTWA DANYCH (nowa)
    │   ├── konfiguracja.ts   adres chmury, stałe synchronizacji
    │   ├── chmura.ts         rozmowa z Edge Functions; błąd sieci ≠ brak dostępu
    │   ├── baza.ts           lokalna baza SQLite + migracje + czyszczenie
    │   ├── repozytorium.ts   odczyt i zapis; UPDATE tylko zmienionych kolumn
    │   ├── kolejka.ts        trwała kolejka wysyłkowa, która nigdy się nie zatyka
    │   ├── synchronizacja.ts silnik sync, auto-wipe, przycinanie okna
    │   ├── sesja.ts          token urządzenia, hasło, biometria, czyszczenie
    │   └── kontekst.tsx      faza aplikacji, blokada po bezczynności
    ├── app/                ekrany (expo-router)
    │   ├── _layout.tsx       bramka: parowanie / hasło / blokada / aplikacja
    │   ├── index.tsx         WIDOK GŁÓWNY - lista klientów + filtr na żywo
    │   ├── usterki.tsx       wszystkie otwarte usterki + filtr statusu
    │   ├── ustawienia.tsx    stan synchronizacji, wylogowanie i wyczyszczenie
    │   ├── klient/[id].tsx   WIDOK PROFILU - duży "DODAJ", zakładki, historia
    │   ├── klient/nowy.tsx   formularz + ostrzeżenie o duplikacie telefonu
    │   ├── wizyta/nowa.tsx   auto + tytuł + opis + priorytet
    │   └── wizyta/[id].tsx   szczegóły, zmiana statusu
    └── komponenty/
        ├── EkranParowania.tsx     kod dla administratora
        ├── EkranBlokady.tsx       ustawienie hasła i odblokowanie
        ├── PasekSynchronizacji.tsx wiek danych + licznik kolejki
        ├── KafelekWizyty.tsx      DUŻY vs MAŁY kafelek zależnie od statusu
        └── … (bez zmian)

backend/
├── src/
│   ├── server.js           panel na 127.0.0.1, obsługa błędów bez danych osobowych
│   ├── config.js           .env, ostrzeżenie przy HOST=0.0.0.0
│   ├── supabase.js         cienki klient service_role (bez zależności)
│   ├── pomocnicze.js       walidacja + czyszczenie danych osobowych z logów
│   ├── routes/admin.js     API panelu
│   └── publiczne/          panel w przeglądarce
└── scripts/
    ├── kopia-zapasowa.js   własna kopia poza Supabase
    ├── przywroc-kopie.js   odtworzenie (przetestuj je!)
    ├── skanuj-sekrety.js   skaner + hook pre-commit
    └── migruj-do-supabase.js  jednorazowy import starej bazy

supabase/
├── migracje/               0001 schemat … 0009 domknięcie advisora
├── funkcje/
│   ├── parowanie/          przyznawanie dostępu telefonom
│   └── sync/               jedyna droga danych do i z telefonu
└── testy/test-anon.ps1     A1: co widzi klucz z aplikacji (ma widzieć nic)
```

---

## Rozwiązywanie problemów

**Panel pisze „Brak SUPABASE_SERVICE_ROLE_KEY”**
Uzupełnij klucz w `backend/.env` — instrukcja w
[DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md).

**Telefon pokazuje kod, ale nic się nie dzieje**
Kod trzeba wpisać w panelu (zakładka **Dostęp**) i wybrać mechanika. Telefon
odpytuje serwer co 5 sekund, więc reakcja jest niemal natychmiastowa.

**Telefon pisze „Dostęp został odebrany”**
Administrator zablokował ten telefon albo konto mechanika, **albo** telefon nie
łączył się z serwerem dłużej niż 14 dni i wyczyścił się sam. Popros
administratora o ponowne przyznanie dostępu.

**Mechanik zapomniał hasła**
Panel → **Dostęp** → „Każ ustawić nowe hasło”. Dane na telefonie zostają.

**Licznik „N czeka” nie spada**
Sprawdź zasięg. Jeśli internet działa, a licznik stoi ponad dobę — zajrzyj do
zakładki **Kwarantanna** w panelu i do kolumny „bez sync (h)” w zakładce
**Stan**.

**Aplikacja pokazuje „ta wersja jest za stara”**
Zapisy nadal działają i nic nie ginie — trzeba tylko zaktualizować aplikację,
żeby znów pobierała dane.

**Chcę zmienić, ile historii trafia na telefony**
Panel → **Ustawienia** → „Okno synchronizacji”. Telefony przyjmą nową wartość
przy najbliższej synchronizacji i same przytną swoją lokalną bazę.
