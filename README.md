# System warsztatu samochodowego

Program dla mechaników na **Windows**, działający **bez internetu**,
z zarządzaniem dostępem wbudowanym w samą aplikację. Dane leżą w bazie Supabase
w regionie UE; każdy komputer trzyma własną, **zaszyfrowaną** kopię roboczą
i pracuje na niej.

To jest **usługa**: dostawca (Ty) nie hostuje niczego u siebie. Cały działający
system to Supabase i komputery w warsztacie.

**System nie przechowuje zdjęć** — ani na komputerze, ani w chmurze. To świadoma
decyzja, która usuwa cały łańcuch ryzyk: metadane GPS i wizerunki osób w tle,
publiczne magazyny plików, rozjazd bazy z plikami, zapchany dysk
i zalanie łącza po powrocie sieci.

```
Nowy folder (5)/
├── frontend/    ekrany aplikacji (React Native Web + Expo) — offline-first
├── windows/     powłoka programu Windows (Electron): baza SQLCipher, klucze DPAPI
├── supabase/    migracje bazy, funkcje brzegowe, test bezpieczeństwa
├── narzedzia/   skrypty dostawcy (zaproszenia, kopie) — NIE serwer
├── rodo/        rejestr czynności, klauzula informacyjna, procedura naruszenia
└── dane/        stara, lokalna baza SQLite (do jednorazowej migracji)
```

📄 **[BEZPIECZENSTWO.md](BEZPIECZENSTWO.md)** — mapa wszystkich ryzyk A/B/C/D:
co zrobione, gdzie w kodzie, co sprawdzone.
📄 **[BUILD-WINDOWS.md](BUILD-WINDOWS.md)** — jak zbudować instalator `.exe`
i co się dzieje przy pierwszym uruchomieniu u mechanika.
📄 **[DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md)** — czynności, których
nie da się wykonać za Ciebie.

---

# 1. Jak to działa

## Architektura

```
   KOMPUTER MECHANIKA                 CHMURA (Supabase, Frankfurt)
   ┌──────────────────────┐          ┌────────────────────────────────┐
   │ ekrany               │          │ Edge Function `sync`           │
   │   ↕ (nigdy do sieci) │          │  · sprawdza token urządzenia   │
   │ SQLite + SQLCipher   │◄────────►│  · wąskie okno danych          │
   │ (klucz w DPAPI)      │  token   │  · kwarantanna zamiast błędu   │
   │   ↕                  │urządzenia├────────────────────────────────┤
   │ kolejka wysyłkowa    │          │ Edge Function `admin`          │
   └──────────────────────┘   ┌─────►│  · tylko rola administrator    │
                              │      ├────────────────────────────────┤
   KOMPUTER ADMINISTRATORA    │      │ Edge Function `parowanie`      │
   (ta sama aplikacja +       │      │  · kody zaproszeń i parowania  │
    ekran „Dostęp")───────────┘      ├────────────────────────────────┤
                                     │ Postgres: RLS bez polityk,     │
                                     │ klucz z aplikacji nie widzi nic│
                                     └────────────────────────────────┘
```

Cztery rzeczy wynikają wprost z tego rysunku:

1. **Ekrany nigdy nie czytają z sieci.** Czytają z lokalnej bazy komputera.
   Brak zasięgu nie spowalnia pracy i nie wylogowuje mechanika.
2. **Klucz wbudowany w aplikację nie daje dostępu do niczego.** Każda tabela ma
   RLS bez żadnej polityki, a rola `anon` nie ma nawet wstępu do schematu.
   Wszystko idzie przez funkcje brzegowe, które sprawdzają imienny token.
3. **Klucz `service_role` nigdy nie opuszcza serwera.** Jest w sekretach
   Supabase i w `narzedzia/.env` — nie ma go w paczce aplikacji.
4. **Nic nie działa na komputerze dostawcy.** Zarządzanie dostępem jest w
   aplikacji; skrypty w `narzedzia/` odpala się z ręki kilka razy w życiu
   projektu.

## Trzy role

| Rola | Kto | Co może |
|---|---|---|
| **Dostawca usługi** | Ty | wystawia kod zaproszenia dla nowego warsztatu; poza tym nie ma wglądu w codzienną pracę |
| **Administrator warsztatu** | właściciel / kierownik | wszystko co mechanik **+ przyznanie dostępu stanowisku + odebranie dostępu** |
| **Mechanik** | pracownik | kartoteki klientów, zgłoszenia, statusy |

Administrator **nie widzi więcej danych klientów** niż mechanik. Różnica to
jeden przycisk: ⚿ w lewym górnym rogu listy klientów.

## Wejście do aplikacji — bez żadnego hasła do systemu

Mechanik nie zna i nigdy nie wpisuje hasła do systemu — takiego hasła nie ma.

### A. Pierwsza osoba w warsztacie — kod zaproszenia

```
Dostawca:  npm run zaproszenie -- "Warsztat u Kowalskiego" "Jan Kowalski"
           → V8KH-ZN9K-LM3X

Właściciel: instaluje aplikację → „Mam kod zaproszenia" → wpisuje kod
           → aplikacja zakłada warsztat i jego konto ADMINISTRATORA
           → ustawia dowolne własne hasło
```

Kod jest jednorazowy i ma datę ważności. Kto go użyje, zostaje administratorem
tego warsztatu.

### B. Każdy kolejny mechanik — prośba o dostęp

```
1. Mechanik otwiera aplikację         →  wpisuje SWOJE imię i nazwisko
                                          i dotyka „Poproś o dostęp"
2. Administrator: ⚿                   →  widzi na liście „Jan Kowalski"
                                          i przycisk Zatwierdź
3. Administrator klika Zatwierdź      →  konto zakłada się samo
4. Program w kilka sekund             →  „Ustaw swoje hasło"
5. Mechanik wpisuje DOWOLNE hasło     →  wchodzi do aplikacji
```

**Administrator nie wpisuje ani jednego znaku.** Nie dyktuje się kodów przez
telefon, nie zakłada się kont „na zapas" i nikt nie zgaduje pisowni cudzego
nazwiska — podaje je ten, kto zna je najlepiej. Administrator sprawdza tylko,
czy prośba jest od właściwej osoby, i klika.

Numer prośby (`88FVB9D9`) jest widoczny po obu stronach, ale służy wyłącznie do
rozróżnienia kilku podobnych zgłoszeń. **Nie jest sekretem** — sam z siebie nic
nie daje: dostęp przyznaje administrator, a token odbiera wyłącznie ten
komputer, który ma sekret zapisany w DPAPI.

Ponowne parowanie tej samej osoby (nowy komputer, reinstalacja) trafia do jej
istniejącego konta, jeśli imię się zgadza. Konto z **odebranym** dostępem nie
zostanie po cichu wskrzeszone — administrator musi najpierw świadomie
przywrócić dostęp na liście.

Hasło mechanika to **blokada programu na tym komputerze**, a nie hasło do bazy.
Nie otwiera niczego w internecie, więc jego wyciek nie daje dostępu do danych.

## Co administrator może zrobić zdalnie

| Akcja (ekran „Dostęp") | Skutek na komputerze mechanika |
|---|---|
| **Zatwierdź** | konto powstaje z podanego imienia, program dostaje token i prosi o hasło |
| **Nowe hasło** | przy najbliższym uruchomieniu prośba o nowe hasło, dane zostają |
| **Zablokuj stanowisko** | dostęp odcięty, lokalna baza skasowana |
| **Odbierz dostęp** (mechanikowi) | to samo, ale na **wszystkich** jego stanowiskach |
| **Przywróć** | stanowisko wraca do pracy bez ponownego parowania |
| **Zgubiony** (wyrejestruj) | sesja unieważniona na stałe, wymagane parowanie od nowa |

Jeśli komputer jest offline i już nigdy się nie połączy — **skasuje dane sam**
po 14 dniach bez synchronizacji (wartość ustawialna per warsztat).

Zabezpieczenie przed zamknięciem się na zewnątrz: administrator nie może
zablokować samego siebie, odciąć własnego stanowiska ani zablokować ostatniego
czynnego administratora warsztatu.

## Jak płyną dane

**Zapis** kończy się w chwili, gdy dane są w lokalnym SQLite. Wysyłka to
osobna sprawa, dziejąca się w tle:

```
mechanik zapisuje → lokalna baza (natychmiast, offline)
                  → kolejka wysyłkowa (trwała, przeżywa restart)
                  → paczkami po 50, gdy jest sieć
                  → serwer: przyjmuje albo odkłada do kwarantanny
                            — NIGDY nie odrzuca trwałym błędem
```

**Odczyt**: komputer dostaje kartoteki swojego warsztatu oraz wizyty z ostatnich
**90 dni plus wszystkie nadal otwarte**. Nie pięć lat historii — to ogranicza
i pierwszą synchronizację, i szkodę ze skradzionego komputera.

**Po przerwie w sieci program dogania serwer sam.** Działają dwa niezależne
mechanizmy, bo żaden z osobna nie wystarcza:

- **nasłuch stanu sieci** (`expo-network`) — reaguje w ułamku sekundy, gdy
  Wi-Fi albo dane wracają; bywa jednak zawodny (potrafi zgłosić „połączony"
  przy martwym łączu),
- **ponawianie z rosnącą przerwą** — 5 s, 10 s, 20 s… do 5 minut, chodzi
  **zawsze**, gdy w kolejce coś czeka, niezależnie od tego, co mówi system.

Nasłuch jest przyspieszaczem, nie fundamentem. Gdyby zawiódł, kolejka i tak
się opróżni — najwyżej minutę później.

Trzy reguły, które chronią przed cichą utratą pracy:

- **Kolejka nigdy nie stoi za jedną pozycją.** Pozycja znika z kolejki dopiero,
  gdy serwer potwierdzi przyjęcie — także wtedy, gdy odłożył ją do kwarantanny.
  Błąd sieci zostawia ją na miejscu.
- **UPDATE dotyka tylko zmienionych kolumn.** Mechanik, który poprawił opis,
  nie cofnie statusu ustawionego w tym czasie przez kolegę.
- **Nic nie jest kasowane fizycznie.** Usunięcie to znacznik; realnie kasuje
  zadanie serwerowe po okresie retencji.

## Bezpieczeństwo w skrócie

| Warstwa | Co ją chroni |
|---|---|
| Baza w chmurze | RLS bez polityk + brak grantów + brak wstępu do schematu dla `anon` |
| Dostęp aplikacji | imienny token urządzenia bez daty ważności, unieważnialny zdalnie |
| Dane na komputerze | SQLCipher, klucz losowany na miejscu i trzymany w DPAPI Windows |
| Ekran | hasło **przy każdym uruchomieniu programu** (nie po bezczynności — patrz A5 w BEZPIECZENSTWO.md) |
| Skradziony komputer | auto-wipe po 14 dniach bez synchronizacji + zdalne odcięcie |
| Kopie zapasowe systemu | dane w `%APPDATA%`, poza katalogami synchronizowanymi z OneDrive |
| Wyniesienie danych | brak eksportu w aplikacji + dziennik dostępu do kartotek |

Pełne uzasadnienie każdej pozycji: [BEZPIECZENSTWO.md](BEZPIECZENSTWO.md).

---

# 2. Uruchomienie

## Baza — już gotowa

Projekt Supabase `Dziennik-dla-warsztatów-serwer` (region eu-central-1) jest
skonfigurowany: schemat, RLS, trzy funkcje brzegowe i codzienne zadanie
retencji działają. Migracje leżą w `supabase/migracje/` — to źródło prawdy
o schemacie, trzymaj je w repozytorium.

## Program — build instalatora

```bash
cd frontend; npm install; npm run eksport-web
cd ../windows; npm install; npm run build
```

W `windows/dist/` powstaje instalator `Warsztat-2.0.0-x64.exe` (ok. 95 MB)
i wersja przenośna. Build robi się w całości na Twoim komputerze — nie ma
chmury budującej, konta ani kolejki.

Pełna instrukcja z wymaganiami, instalacją u mechanika i listą typowych
potknięć: **[BUILD-WINDOWS.md](BUILD-WINDOWS.md)**.

> **Przeglądarka nie wystarcza.** Szyfrowanie bazy (SQLCipher) i klucz w DPAPI
> działają wyłącznie w zbudowanym programie — `npm run web` to podgląd
> interfejsu, nie narzędzie pracy.

## Podgląd w przeglądarce

```bash
cd frontend
npm run web        # otwiera http://localhost:8081
```

Nic nie trzeba wcześniej konfigurować: adres projektu Supabase i klucz publiczny
są wpisane na stałe w `frontend/app.config.js`, więc aplikacja od pierwszej
sekundy gada z tym samym serwerem co gotowy program. Nigdzie nie ma pola „wklej
adres backendu" — ani w przeglądarce, ani w programie.

Wersja w przeglądarce służy **wyłącznie do oglądania interfejsu**. Nie ma tam
DPAPI ani SQLCipher, więc token, hasło i baza leżą w zwykłym
`localStorage` / OPFS. Aplikacja mówi o tym wprost pomarańczowym paskiem przez
cały czas i nie nadaje się do pracy na prawdziwych danych klientów.

Ten sam kod ekranów działa w programie i w przeglądarce — różnicę robią
`src/dane/mostWindows.ts` i `src/dane/pamiecBezpieczna.ts`, jedyne miejsca,
które wiedzą o istnieniu obu światów.

### Dwie rzeczy, o które ten podgląd się kiedyś wywracał

1. **`Worker chunk not found for: .../expo-sqlite/web/worker.ts`** — brał się
   z renderowania statycznego (`web.output: "static"` w `app.json`). Serwer
   deweloperski składał wtedy drugą, serwerową paczkę, do której wątek roboczy
   SQLite się nie łapał, i `localhost:8081` zwracał 500 jeszcze przed
   uruchomieniem czegokolwiek. Aplikacja to jedno okno chowane za hasłem,
   nie strona do indeksowania, więc web chodzi teraz jako `"single"` (zwykłe
   SPA). Program Windows ładuje dokładnie tę samą, pojedynczą stronę.
2. **`Invalid VFS state` → `Error code 14: unable to open database file`** —
   dwa równoległe wywołania `otworzBaze()` przy starcie otwierały dwa
   połączenia do tej samej bazy. `src/dane/baza.ts` trzyma teraz jedną
   wspólną obietnicę otwarcia. Ten sam błąd siedział w gotowym programie,
   tam tylko trudniejszy do zauważenia.

**Jedna karta na raz.** SQLite w przeglądarce blokuje swoje pliki (OPFS) na
wyłączność, więc druga otwarta karta z `localhost:8081` bazy nie otworzy.
Aplikacja mówi to wprost — czerwoną kartą „Nie udało się otworzyć danych"
zamiast wiszącego w nieskończoność kręciołka. Zamknij pozostałe karty
i **odśwież** tę (samo „spróbuj ponownie" bez przeładowania nie pomoże:
wątek roboczy SQLite zapamiętuje nieudaną inicjalizację na stałe).
W gotowym programie problem nie istnieje — bazę otwiera proces główny.

## Klucze — co gdzie mieszka

| Plik / miejsce | Co trzyma | W repozytorium? |
|---|---|---|
| `frontend/.env` | `EXPO_PUBLIC_SUPABASE_URL`, `..._PUBLISHABLE_KEY`, `..._ANON_KEY` | **tak** — Expo i tak wkleja je do zbudowanych ekranów, są publiczne z definicji |
| `narzedzia/.env` | `SUPABASE_SERVICE_ROLE_KEY` | **nie** — omija RLS, zostaje na komputerze dostawcy |
| sekrety Supabase | `SUPABASE_SERVICE_ROLE_KEY` dla Edge Functions | n/d — wstrzykiwane automatycznie |

Klucz publiczny nie daje dostępu do niczego: każda tabela ma RLS bez żadnej
polityki, a role `anon` i `authenticated` nie mają nawet wstępu do schematu.
Sprawdzenie: `supabase/testy/test-anon.ps1`.

Podział pilnują **dwa niezależne bezpieczniki**:

- `app.config.js` — przerywa build, jeśli w `frontend/.env` znajdzie token
  z rolą inną niż `anon` albo klucz `sb_secret_...`,
- `npm run skanuj` + hook `pre-commit` — blokuje commit z sekretem, w tym
  sekret pod prefiksem `EXPO_PUBLIC_` (który trafiłby do paczki nawet
  z pliku spoza repozytorium).

## Nowy warsztat

```bash
cd narzedzia
npm install
npm run zaproszenie -- "Warsztat u Kowalskiego" "Jan Kowalski" --prefiks WK --dni 30
```

Kod przekazujesz klientowi. Dalej warsztat radzi sobie sam.

## Narzędzia dostawcy

```bash
cd narzedzia
npm run zaproszenie -- "Nazwa" "Imię Nazwisko"   # nowy warsztat
npm run kopia                                     # kopia poza Supabase
npm run przywroc -- kopie/x.json                  # odtworzenie (--na-sucho = próba)
npm run skanuj -- --hook                          # skaner sekretów + hook pre-commit
npm run migruj -- --zapisz                        # import starej bazy SQLite
```

Wymagają `narzedzia/.env` z kluczem `service_role` (wzór w `.env.example`).

---

# 3. Interfejs aplikacji

Cały interfejs jest projektowany pod **wąskie okno** w proporcjach około 9:16 —
wysokie i wąskie. Odpowiada za to `frontend/src/uklad.ts` oraz komponent
`KolumnaEkranu`, który owija całą nawigację. Okno programu startuje dokładnie
w tych proporcjach (460 × 880), więc treść zajmuje je w całości; dopiero po
rozciągnięciu okna kolumna przestaje rosnąć i staje na środku.

**Skala** — wszystkie odstępy, czcionki i zaokrąglenia są liczone względem
okna referencyjnego 360 × 640 dp przez funkcję `s()`, z ograniczeniem
0.85–1.3. Elementy zajmujące stałą część wysokiego okna używają `wys(procent)`:

| Element | Reguła | małe okno | domyślne okno | okno rozciągnięte |
|---|---|---|---|---|
| Duży przycisk „DODAJ" | 11% wysokości (84–120) | 84 | 101 | 113 |
| Kafelek nienaprawionej usterki | 16% wysokości (min 132) | 132 | 146 | 164 |
| Kafelek naprawionej usterki | cel kliknięcia 44 dp | 46 | 50 | 57 |

Proporcja „duży kafelek do małego" trzyma się na poziomie **ok. 2.9×** przy
każdym rozmiarze okna — kluczowe wyróżnienie usterek nienaprawionych nie
rozjeżdża się po zmianie rozmiaru. Każdy element klikalny ma co najmniej 44 dp.

## Bramka wejściowa

Zanim mechanik zobaczy jakiekolwiek dane, aplikacja ustala fazę urządzenia:

```
parowanie    → kod dla administratora albo kod zaproszenia
ustaw_haslo  → dostęp przyznany, mechanik wybiera własne hasło
zablokowana  → hasło jest, trzeba je podać (lub odcisk palca)
gotowa       → normalna praca
```

O fazie decyduje **wyłącznie zawartość dysku**. Żaden brak sieci nie
przełączy mechanika na ekran logowania.

## Widok główny — lista klientów

| Wymaganie | Realizacja |
|---|---|
| Pełna lista klientów od razu po wejściu | odczyt z lokalnej bazy, natychmiastowy, także bez zasięgu |
| Pole wyszukiwania nad listą | `PoleWyszukiwania` w nagłówku ekranu |
| Filtr **na żywo** ukrywający niepasujących | filtrowanie lokalne — reaguje na każdą literę |
| Przycisk „Dodaj" widoczny, ale poza centrum | pigułka **„+ Dodaj"** w prawym górnym rogu |
| Stan wysyłki | **nie ma go na ekranach roboczych** — synchronizacja jest niewidoczna |
| Zarządzanie dostępem | ikona ⚿ w lewym górnym rogu — **tylko dla administratora** |

Wyszukiwarka ignoruje polskie znaki i spacje: `zielinska` znajdzie `Zielińska`,
a `kr12345` znajdzie auto opisane jako `KR 12345`. Przeszukiwane są nazwa,
telefon, e-mail, adres i opisy aut z wizyt tego klienta.

Plakietka **„N otwartych usterek"** prowadzi na ekran zbiorczy.

## Synchronizacja — niewidoczna

Na ekranach roboczych **nie ma po niej ani śladu**: żadnego paska, licznika ani
zegarków przy kafelkach. Mechanik ma widzieć klientów, nie stan transmisji.

Dzieje się sama:

- natychmiast po każdym zapisie (`odswiezLicznikiKolejki` odpala wysyłkę),
- co 45 sekund w tle, **także przy zablokowanym ekranie** — dzięki temu dane są
  świeże już w chwili wpisania hasła, a polecenie „zablokuj / wyczyść ten
  komputer" dociera nawet do stanowiska, którego nikt nie odblokowuje,
- natychmiast po powrocie internetu (zdarzenie `online`).

Bez zasięgu zapis siedzi w trwałej kolejce i **nic nie ginie** — kolejka
przeżywa restart aplikacji.

Jedyne miejsce, gdzie to widać, to ⚙ *Aplikacja i synchronizacja*: mała kropka
u góry ekranu. Zielony `✓` znaczy „wszystko wysłane", pomarańczowa liczba —
ile pozycji jeszcze czeka. Dotknięcie wysyła je od razu.

## Otwarte usterki

Zbiorcza lista niezamkniętych zgłoszeń ze **wszystkich** kartotek. Dwa przyciski
filtrujące („W trakcie", „Nie naprawione") z licznikami; ponowne dotknięcie
aktywnego przycisku zdejmuje filtr. Kolejność: **priorytet malejąco**, przy
równym priorytecie nienaprawione przed „w trakcie", na końcu nowsza data.

## Profil klienta

Na samej górze duży przycisk **„DODAJ"** (nowa wizyta), poniżej dane klienta,
zakładki filtrowania po aucie i pełna historia. Zakładki powstają z unikalnych
opisów aut wpisanych przy wizytach — nie ma kartoteki pojazdów.

Jeśli inny komputer założył kartotekę z tym samym numerem telefonu, na górze
pojawia się propozycja **scalenia** — offline nic tego nie wykryje za mechanika.

## Kafelki historii

| | Nienaprawione / w trakcie | Naprawione |
|---|---|---|
| Wysokość | 16% wysokości ekranu, min. 132 dp | cel dotyku 44 dp (~2.9× mniej) |
| Tło | kolorowe (czerwone / bursztynowe) | białe, stonowane |
| Lewa krawędź | gruba, 8 px, w kolorze statusu | brak |
| Cień | mocny | brak |
| Opis usterki | widoczny (do 3 linii) | ukryty |
| Dodatki | odznaka statusu, priorytet, przebieg | kropka statusu i jedna linia podpisu |

## Auto jako swobodny tekst

Nie ma osobnej kartoteki pojazdów. Formularz nowego zgłoszenia ma trzy okienka
plus wybór priorytetu:

| Pole | Wymagane | Uwagi |
|---|---|---|
| **Auto** | nie | Swobodny tekst, bez walidacji. Może być marka i rejestracja, może być „tańsze auto pana Adama". |
| **Tytuł wizyty** | tak | Krótka nazwa zgłoszenia. |
| **Opis** | nie | Szczegóły usterki. |

Statusu **nie wybiera się przy dodawaniu** — każde nowe zgłoszenie startuje
jako `nienaprawione` i idzie ścieżką `nienaprawione → w_trakcie → naprawione`.

### Edycja i usuwanie

Zgłoszenie i kartotekę klienta można poprawić — przyciskiem „Edytuj" na ekranie
szczegółów. Przed zapisem pojawia się **pytanie z listą zmian** (`było → jest`),
więc widać czarno na białym, co się zmieni. Do kolejki idą wyłącznie kolumny,
które faktycznie się zmieniły, więc poprawka opisu nie cofnie statusu
ustawionego w tym czasie przez kolegę.

**Zgłoszenie można usunąć dopiero 30 dni po oznaczeniu go jako naprawione.**
Wcześniej przycisk się nie pojawia — zamiast niego jest wyjaśnienie, ile dni
zostało. Historia napraw bywa dowodem przy reklamacji, a skasowanie jej jest
nieodwracalne.

Konsekwencja przyjęta świadomie: **zgłoszenia otwartego nie da się usunąć
wcale**. Pomyłkę poprawia się edycją albo zamknięciem, nie kasowaniem.

Regułę egzekwuje baza (`mozna_usunac_wizyte`), nie tylko interfejs. Gdyby
odmowa przyszła już po wyjściu z ekranu, aplikacja przywraca zgłoszenie
lokalnie i pokazuje powód paskiem na górze — żeby nie wyglądało to na
samoczynne cofnięcie się usunięcia.

### Klawiatura

Wszystkie formularze siedzą w `KeyboardAwareScrollView`
(`react-native-keyboard-controller`): przy otwarciu klawiatury treść przesuwa
się w górę, aktywne pole samo wjeżdża nad klawiaturę, a ekran **pozostaje
normalnie przewijalny**. Na komputerze z klawiaturą ekranową (laptop 2w1)
działa to tak samo jak na urządzeniu dotykowym.

Jeśli to samo auto ma już otwartą wizytę z ostatnich 48 godzin, formularz
o tym mówi **zanim** powstanie drugie zgłoszenie tej samej usterki.

Numer roboczy (`WK-2026-0001`) nadaje program od razu, także offline. Numer
oficjalny (`WK/2026/0001`) nadaje serwer przy synchronizacji — dzięki temu dwa
warsztaty pracujące bez sieci nie wygenerują tego samego numeru.

## Ekran „Dostęp" — tylko administrator

Dwie sekcje: **prośby o dostęp** (imię i nazwisko podane przez mechanika +
przycisk Zatwierdź) oraz lista mechaników z ich stanowiskami i akcjami. Nie ma tu
ani jednego pola do wpisania — konta powstają same przy zatwierdzaniu prośby.
Lista odświeża się co 15 sekund, żeby administrator nie musiał zgadywać, kiedy
pojawi się nowa prośba.

Przy **własnym** koncie i stanowisku administratora nie ma przycisków
odcinających — nie da się zablokować samego siebie.

Ekran **nie pokazuje żadnej kartoteki klienta** — to zarządzanie dostępem, a nie
wgląd we wszystko. Wymaga internetu; praca na kartotekach działa dalej bez sieci.

---

# 4. Struktura plików

```
frontend/
├── app.json                konfiguracja Expo (adres chmury, klucz publiczny)
└── src/
    ├── dane/               ← WARSTWA DANYCH
    │   ├── konfiguracja.ts   adres chmury, stałe synchronizacji
    │   ├── chmura.ts         rozmowa z funkcjami brzegowymi; błąd sieci ≠ brak dostępu
    │   ├── baza.ts           lokalna baza SQLite + SQLCipher + migracje
    │   ├── repozytorium.ts   odczyt i zapis; UPDATE tylko zmienionych kolumn
    │   ├── kolejka.ts        trwała kolejka wysyłkowa, która nigdy się nie zatyka
    │   ├── synchronizacja.ts silnik sync, auto-wipe, przycinanie okna
    │   ├── sesja.ts          token urządzenia, hasło, czyszczenie
    │   ├── mostWindows.ts    jedyne wejście do bazy i kluczy po stronie Windows
    │   └── kontekst.tsx      faza aplikacji, rola, blokada przy starcie
    ├── app/                ekrany (expo-router)
    │   ├── _layout.tsx       bramka: parowanie / hasło / blokada / aplikacja
    │   ├── index.tsx         WIDOK GŁÓWNY — lista klientów + filtr na żywo
    │   ├── usterki.tsx       wszystkie otwarte usterki + filtr statusu
    │   ├── administracja.tsx EKRAN DOSTĘPU — tylko dla administratora
    │   ├── ustawienia.tsx    znacznik kolejki, wylogowanie i wyczyszczenie
    │   ├── klient/[id].tsx   WIDOK PROFILU — duży „DODAJ", zakładki, historia
    │   ├── klient/nowy.tsx   formularz + ostrzeżenie o duplikacie numeru
    │   ├── kalendarz.tsx     grafik warsztatu, dzień po dniu
    │   ├── wizyta/nowa.tsx   auto + tytuł + opis + priorytet + termin
    │   └── wizyta/[id].tsx   szczegóły, zmiana statusu
    └── komponenty/
        ├── EkranParowania.tsx     kod dla administratora + kod zaproszenia
        ├── EkranBlokady.tsx       ustawienie hasła i odblokowanie
        ├── SiatkaDnia.tsx         doba z wizytami — kalendarz i wybór terminu
        ├── WyborTerminu.tsx       czas trwania wizyty wybierany palcem
        ├── KafelekWizyty.tsx      DUŻY vs MAŁY kafelek zależnie od statusu
        └── … (KafelekKlienta, ZakladkiAut, Formularz, Stany, Potwierdzenie)

windows/                    powłoka programu Windows (Electron)
├── glowny.js               okno, baza SQLCipher, klucze w DPAPI, protokół app://
├── mostek.js               wąskie API wystawione ekranom (window.warsztat)
└── package.json            zależności i konfiguracja electron-builder

supabase/
├── migracje/               0001 schemat … 0011 funkcje administratora
├── funkcje/
│   ├── parowanie/          kody zaproszeń i parowania, wydanie tokenu
│   ├── sync/               jedyna droga danych do i z komputera
│   └── admin/              przyznawanie i odbieranie dostępu
└── testy/test-anon.ps1     A1: co widzi klucz z aplikacji (ma widzieć nic)

narzedzia/                  skrypty dostawcy — NIE serwer, nic nie działa w tle
├── src/{config,supabase}.js
└── scripts/
    ├── zaproszenie.js        kod dla nowego warsztatu
    ├── kopia-zapasowa.js     własna kopia poza Supabase
    ├── przywroc-kopie.js     odtworzenie (przetestuj je!)
    ├── skanuj-sekrety.js     skaner + hook pre-commit
    └── migruj-do-supabase.js jednorazowy import starej bazy
```

---

# 5. Rozwiązywanie problemów

**Stanowisko czeka na zgodę, ale nic się nie dzieje**
Administrator musi kliknąć **Zatwierdź** przy tej prośbie (ikona ⚿). Program
odpytuje serwer co 5 sekund, więc reakcja jest niemal natychmiastowa. Jeśli na
liście administratora nie widać prośby — mechanik nie wpisał imienia i nazwiska
albo prośba jest starsza niż 24 godziny; wtedy niech poprosi jeszcze raz.

**Administrator klika Zatwierdź i dostaje „ma odebrany dostęp"**
Ktoś o tym imieniu i nazwisku był już w warsztacie i dostęp mu odebrano.
Świadoma decyzja: najpierw **Przywróć** przy jego koncie na liście mechaników,
potem zatwierdź stanowisko.

**Nie widzę ikony ⚿**
To konto nie ma roli administratora. Rola przychodzi z serwera przy każdej
synchronizacji — sprawdź w Ustawieniach pozycję „Uprawnienia".

**Program pisze „Dostęp został odebrany"**
Administrator zablokował to stanowisko albo konto mechanika, **albo** komputer
nie łączył się z serwerem dłużej niż 14 dni i wyczyścił się sam. Trzeba przyznać
dostęp od nowa.

**Mechanik zapomniał hasła**
Ekran „Dostęp" → przy jego stanowisku → **Nowe hasło**. Dane na dysku zostają.

**Kropka w Ustawieniach pokazuje liczbę, która nie spada**
Sprawdź połączenie z internetem. Jeśli internet działa, a liczba stoi ponad dobę — zajrzyj do
tabeli `kwarantanna` w panelu Supabase; tam lądują zapisy, których baza nie
przyjęła.

**Aplikacja pokazuje „ta wersja jest za stara"**
Zapisy nadal działają i nic nie ginie — trzeba tylko zaktualizować aplikację,
żeby znów pobierała dane.

**Chcę zmienić, ile historii trafia na komputery**
Kolumna `okno_dni` w tabeli `warsztaty` (panel Supabase). Programy przyjmą nową
wartość przy najbliższej synchronizacji i same przytną swoją lokalną bazę.

**Wszystkie warsztaty stoją**
Sprawdź [status.supabase.com](https://status.supabase.com) i czy płatność za
projekt przeszła. Praca offline idzie dalej — zmiany kolejkują się na
komputerach i dojdą po powrocie usługi.
