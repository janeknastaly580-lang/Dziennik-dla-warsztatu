# System warsztatu samochodowego

Aplikacja mobilna dla mechaników, działająca **bez internetu**, z zarządzaniem
dostępem wbudowanym w samą aplikację. Dane leżą w bazie Supabase w regionie UE;
każdy telefon trzyma własną, **zaszyfrowaną** kopię roboczą i pracuje na niej.

To jest **usługa**: dostawca (Ty) nie hostuje niczego u siebie. Cały działający
system to Supabase i telefony w warsztacie.

**System nie przechowuje zdjęć** — ani na telefonie, ani w chmurze. To świadoma
decyzja, która usuwa cały łańcuch ryzyk: metadane GPS i wizerunki osób w tle,
publiczne magazyny plików, rozjazd bazy z plikami, zapchaną pamięć telefonu
i zalanie łącza po powrocie sieci.

```
Nowy folder (5)/
├── frontend/    aplikacja mobilna (React Native + Expo) — offline-first
├── supabase/    migracje bazy, funkcje brzegowe, test bezpieczeństwa
├── narzedzia/   skrypty dostawcy (zaproszenia, kopie) — NIE serwer
├── rodo/        rejestr czynności, klauzula informacyjna, procedura naruszenia
└── dane/        stara, lokalna baza SQLite (do jednorazowej migracji)
```

📄 **[BEZPIECZENSTWO.md](BEZPIECZENSTWO.md)** — mapa wszystkich ryzyk A/B/C/D:
co zrobione, gdzie w kodzie, co sprawdzone.
📄 **[DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md)** — build APK i czynności,
których nie da się wykonać za Ciebie.

---

# 1. Jak to działa

## Architektura

```
   TELEFON MECHANIKA                  CHMURA (Supabase, Frankfurt)
   ┌──────────────────────┐          ┌────────────────────────────────┐
   │ ekrany               │          │ Edge Function `sync`           │
   │   ↕ (nigdy do sieci) │          │  · sprawdza token urządzenia   │
   │ SQLite + SQLCipher   │◄────────►│  · wąskie okno danych          │
   │ (klucz w Keystore)   │  token   │  · kwarantanna zamiast błędu   │
   │   ↕                  │urządzenia├────────────────────────────────┤
   │ kolejka wysyłkowa    │          │ Edge Function `admin`          │
   └──────────────────────┘   ┌─────►│  · tylko rola administrator    │
                              │      ├────────────────────────────────┤
   TELEFON ADMINISTRATORA     │      │ Edge Function `parowanie`      │
   (ta sama aplikacja +       │      │  · kody zaproszeń i parowania  │
    ekran „Dostęp")───────────┘      ├────────────────────────────────┤
                                     │ Postgres: RLS bez polityk,     │
                                     │ klucz z aplikacji nie widzi nic│
                                     └────────────────────────────────┘
```

Cztery rzeczy wynikają wprost z tego rysunku:

1. **Ekrany nigdy nie czytają z sieci.** Czytają z lokalnej bazy telefonu.
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
| **Administrator warsztatu** | właściciel / kierownik | wszystko co mechanik **+ przyznanie dostępu telefonowi + odebranie dostępu** |
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

### B. Każdy kolejny mechanik — kod parowania

```
1. Mechanik otwiera aplikację         →  na ekranie KOD: 88FVB9D9
2. Podaje kod administratorowi           (telefonicznie, SMS-em, jakkolwiek)
3. Administrator: ⚿ → dotyka kodu na liście → wybiera mechanika → Przyznaj
4. Telefon w kilka sekund              →  „Ustaw swoje hasło"
5. Mechanik wpisuje DOWOLNE hasło      →  wchodzi do aplikacji
```

Od tej chwili wchodzi tym hasłem albo odciskiem palca. Kod parowania **nie jest
sekretem** — sam z siebie nic nie daje: dostęp przyznaje administrator, a token
odbiera wyłącznie ten telefon, który ma sekret zapisany w Keychain/Keystore.

Hasło mechanika to **blokada aplikacji na tym telefonie**, a nie hasło do bazy.
Nie otwiera niczego w internecie, więc jego wyciek nie daje dostępu do danych.

## Co administrator może zrobić zdalnie

| Akcja (ekran „Dostęp") | Skutek na telefonie mechanika |
|---|---|
| **Przyznaj dostęp** | telefon dostaje token i prosi o ustawienie hasła |
| **Nowe hasło** | przy najbliższym uruchomieniu prośba o nowe hasło, dane zostają |
| **Zablokuj telefon** | dostęp odcięty, lokalna baza skasowana |
| **Odbierz dostęp** (mechanikowi) | to samo, ale na **wszystkich** jego telefonach |
| **Przywróć** | telefon wraca do pracy bez ponownego parowania |
| **Zgubiony** (wyrejestruj) | sesja unieważniona na stałe, wymagane parowanie od nowa |

Jeśli telefon jest offline i już nigdy się nie połączy — **skasuje dane sam**
po 14 dniach bez synchronizacji (wartość ustawialna per warsztat).

Zabezpieczenie przed zamknięciem się na zewnątrz: administrator nie może
zablokować samego siebie, odciąć własnego telefonu ani zablokować ostatniego
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

**Odczyt**: telefon dostaje kartoteki swojego warsztatu oraz wizyty z ostatnich
**90 dni plus wszystkie nadal otwarte**. Nie pięć lat historii — to ogranicza
i pierwszą synchronizację, i szkodę z zgubionego telefonu.

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
| Dane na telefonie | SQLCipher, klucz losowany na urządzeniu i trzymany w Keystore |
| Ekran | hasło lub biometria; blokada po 5 min bezczynności i przy przejściu w tło |
| Zgubiony telefon | auto-wipe po 14 dniach bez synchronizacji + zdalne odcięcie |
| Kopie zapasowe systemu | wyłączone (iCloud, Google Drive, transfer między urządzeniami) |
| Wyniesienie danych | brak eksportu w aplikacji + dziennik dostępu do kartotek |

Pełne uzasadnienie każdej pozycji: [BEZPIECZENSTWO.md](BEZPIECZENSTWO.md).

---

# 2. Uruchomienie

## Baza — już gotowa

Projekt Supabase `Dziennik-dla-warsztatów-serwer` (region eu-central-1) jest
skonfigurowany: schemat, RLS, trzy funkcje brzegowe i codzienne zadanie
retencji działają. Migracje leżą w `supabase/migracje/` — to źródło prawdy
o schemacie, trzymaj je w repozytorium.

## Aplikacja — build APK

```bash
cd frontend
npm install
npx eas login
npx eas build:configure
npx eas build --platform android --profile preview
```

Profil `preview` (już w `eas.json`) daje plik **.apk** do zainstalowania wprost
na telefonach. Build robi się w chmurze EAS — na Twoim komputerze nie zostaje
nic działającego.

> **Expo Go nie wystarcza.** Szyfrowanie bazy (SQLCipher), wyłączenie kopii do
> iCloud/Google Drive i zablokowane uprawnienia aparatu działają wyłącznie we
> własnym buildzie. Szczegóły i weryfikacja: [DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md).

Aplikacja **nie ma wersji webowej** — w przeglądarce nie istnieje
Keychain/Keystore, więc token urządzenia, hasło i klucz szyfrowania bazy nie
miałyby gdzie bezpiecznie leżeć.

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

Cały interfejs jest projektowany pod ekran telefonu w proporcjach około 9:16 —
wysoki i wąski. Odpowiada za to `frontend/src/uklad.ts` oraz komponent
`RamkaTelefonu`, który owija całą nawigację. Na tablecie aplikacja rysuje się
wewnątrz obudowy telefonu; na telefonie ramka znika.

**Skala** — wszystkie odstępy, czcionki i zaokrąglenia są liczone względem
telefonu referencyjnego 360 × 640 dp przez funkcję `s()`, z ograniczeniem
0.85–1.3. Elementy zajmujące stałą część wysokiego ekranu używają `wys(procent)`:

| Element | Reguła | iPhone SE | Pixel 7 | iPad |
|---|---|---|---|---|
| Duży przycisk „DODAJ" | 11% wysokości (84–120) | 84 | 101 | 113 |
| Kafelek nienaprawionej usterki | 16% wysokości (min 132) | 132 | 146 | 164 |
| Kafelek naprawionej usterki | cel dotyku 44 dp | 46 | 50 | 57 |

Proporcja „duży kafelek do małego" trzyma się na poziomie **ok. 2.9×** na
każdym urządzeniu — kluczowe wyróżnienie usterek nienaprawionych nie rozjeżdża
się na innym telefonie. Każdy element dotykowy ma co najmniej 44 dp.
Orientacja jest zablokowana na pionową.

## Bramka wejściowa

Zanim mechanik zobaczy jakiekolwiek dane, aplikacja ustala fazę urządzenia:

```
parowanie    → kod dla administratora albo kod zaproszenia
ustaw_haslo  → dostęp przyznany, mechanik wybiera własne hasło
zablokowana  → hasło jest, trzeba je podać (lub odcisk palca)
gotowa       → normalna praca
```

O fazie decyduje **wyłącznie zawartość telefonu**. Żaden brak sieci nie
przełączy mechanika na ekran logowania.

## Widok główny — lista klientów

| Wymaganie | Realizacja |
|---|---|
| Pełna lista klientów od razu po wejściu | odczyt z lokalnej bazy, natychmiastowy, także bez zasięgu |
| Pole wyszukiwania nad listą | `PoleWyszukiwania` w nagłówku ekranu |
| Filtr **na żywo** ukrywający niepasujących | filtrowanie lokalne — reaguje na każdą literę |
| Przycisk „Dodaj" widoczny, ale poza centrum | pigułka **„+ Dodaj"** w prawym górnym rogu |
| Wiek danych i stan wysyłki | **pasek synchronizacji** nad listą |
| Zarządzanie dostępem | ikona ⚿ w lewym górnym rogu — **tylko dla administratora** |

Wyszukiwarka ignoruje polskie znaki i spacje: `zielinska` znajdzie `Zielińska`,
a `kr12345` znajdzie auto opisane jako `KR 12345`. Przeszukiwane są nazwa,
telefon, e-mail, adres i opisy aut z wizyt tego klienta.

Plakietka **„N otwartych usterek"** prowadzi na ekran zbiorczy.

## Pasek synchronizacji

Stale widoczny nad każdą listą:

```
● dane aktualne              ✓ wysłane
● dane sprzed 14 min         ⏱ 3 czeka
● dane sprzed 3 dni          ⏱ 3 czeka     ← czerwony
```

Dotknięcie paska = natychmiastowa synchronizacja. Pociągnięcie listy w dół
robi to samo. Gdy najstarsza zmiana czeka ponad dobę, pojawia się ostrzeżenie
na całą szerokość — to sygnał, że coś jest nie tak z siecią albo z serwerem.

## Otwarte usterki

Zbiorcza lista niezamkniętych zgłoszeń ze **wszystkich** kartotek. Dwa przyciski
filtrujące („W trakcie", „Nie naprawione") z licznikami; ponowne dotknięcie
aktywnego przycisku zdejmuje filtr. Kolejność: **priorytet malejąco**, przy
równym priorytecie nienaprawione przed „w trakcie", na końcu nowsza data.

## Profil klienta

Na samej górze duży przycisk **„DODAJ"** (nowa wizyta), poniżej dane klienta,
zakładki filtrowania po aucie i pełna historia. Zakładki powstają z unikalnych
opisów aut wpisanych przy wizytach — nie ma kartoteki pojazdów.

Jeśli inny telefon założył kartotekę z tym samym numerem telefonu, na górze
pojawia się propozycja **scalenia** — offline nic tego nie wykryje za mechanika.

## Kafelki historii

| | Nienaprawione / w trakcie | Naprawione |
|---|---|---|
| Wysokość | 16% wysokości ekranu, min. 132 dp | cel dotyku 44 dp (~2.9× mniej) |
| Tło | kolorowe (czerwone / bursztynowe) | białe, stonowane |
| Lewa krawędź | gruba, 8 px, w kolorze statusu | brak |
| Cień | mocny | brak |
| Opis usterki | widoczny (do 3 linii) | ukryty |
| Dodatki | odznaka statusu, priorytet, przebieg, **„⏱ czeka na wysłanie"** | kropka statusu i jedna linia podpisu |

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

Jeśli to samo auto ma już otwartą wizytę z ostatnich 48 godzin, formularz
o tym mówi **zanim** powstanie drugie zgłoszenie tej samej usterki.

Numer roboczy (`WK-2026-0001`) nadaje telefon od razu, także offline. Numer
oficjalny (`WK/2026/0001`) nadaje serwer przy synchronizacji — dzięki temu dwa
warsztaty pracujące bez sieci nie wygenerują tego samego numeru.

## Ekran „Dostęp" — tylko administrator

Trzy sekcje: telefony czekające na dostęp (z kodami do dotknięcia), lista
mechaników z ich telefonami i akcjami, formularz nowego konta. Lista odświeża
się sama co 15 sekund, żeby administrator nie musiał zgadywać, kiedy pojawi się
kod mechanika.

Ekran **nie pokazuje żadnej kartoteki klienta** — to zarządzanie dostępem, a nie
wgląd we wszystko. Wymaga internetu; praca na kartotekach działa dalej bez sieci.

---

# 4. Struktura plików

```
frontend/
├── app.json                konfiguracja Expo (adres chmury, klucz publiczny, SQLCipher)
├── eas.json                profile buildu: preview (.apk) i production (.aab)
├── plugins/prywatnosc.js   A12: wyłączenie kopii do iCloud i Google Drive
└── src/
    ├── dane/               ← WARSTWA DANYCH
    │   ├── konfiguracja.ts   adres chmury, stałe synchronizacji
    │   ├── chmura.ts         rozmowa z funkcjami brzegowymi; błąd sieci ≠ brak dostępu
    │   ├── baza.ts           lokalna baza SQLite + SQLCipher + migracje
    │   ├── repozytorium.ts   odczyt i zapis; UPDATE tylko zmienionych kolumn
    │   ├── kolejka.ts        trwała kolejka wysyłkowa, która nigdy się nie zatyka
    │   ├── synchronizacja.ts silnik sync, auto-wipe, przycinanie okna
    │   ├── sesja.ts          token urządzenia, hasło, biometria, czyszczenie
    │   └── kontekst.tsx      faza aplikacji, rola, blokada po bezczynności
    ├── app/                ekrany (expo-router)
    │   ├── _layout.tsx       bramka: parowanie / hasło / blokada / aplikacja
    │   ├── index.tsx         WIDOK GŁÓWNY — lista klientów + filtr na żywo
    │   ├── usterki.tsx       wszystkie otwarte usterki + filtr statusu
    │   ├── administracja.tsx EKRAN DOSTĘPU — tylko dla administratora
    │   ├── ustawienia.tsx    stan synchronizacji, wylogowanie i wyczyszczenie
    │   ├── klient/[id].tsx   WIDOK PROFILU — duży „DODAJ", zakładki, historia
    │   ├── klient/nowy.tsx   formularz + ostrzeżenie o duplikacie telefonu
    │   ├── wizyta/nowa.tsx   auto + tytuł + opis + priorytet
    │   └── wizyta/[id].tsx   szczegóły, zmiana statusu
    └── komponenty/
        ├── EkranParowania.tsx     kod dla administratora + kod zaproszenia
        ├── EkranBlokady.tsx       ustawienie hasła i odblokowanie
        ├── PasekSynchronizacji.tsx wiek danych + licznik kolejki
        ├── KafelekWizyty.tsx      DUŻY vs MAŁY kafelek zależnie od statusu
        └── … (KafelekKlienta, ZakladkiAut, Formularz, Stany, Potwierdzenie)

supabase/
├── migracje/               0001 schemat … 0011 funkcje administratora
├── funkcje/
│   ├── parowanie/          kody zaproszeń i parowania, wydanie tokenu
│   ├── sync/               jedyna droga danych do i z telefonu
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

**Telefon pokazuje kod, ale nic się nie dzieje**
Kod trzeba wpisać w aplikacji administratora (ikona ⚿) i wybrać mechanika.
Telefon odpytuje serwer co 5 sekund, więc reakcja jest niemal natychmiastowa.

**Nie widzę ikony ⚿**
Ten telefon nie ma roli administratora. Rola przychodzi z serwera przy każdej
synchronizacji — sprawdź w Ustawieniach pozycję „Uprawnienia".

**Telefon pisze „Dostęp został odebrany"**
Administrator zablokował ten telefon albo konto mechanika, **albo** telefon nie
łączył się z serwerem dłużej niż 14 dni i wyczyścił się sam. Trzeba przyznać
dostęp od nowa.

**Mechanik zapomniał hasła**
Ekran „Dostęp" → przy jego telefonie → **Nowe hasło**. Dane na telefonie zostają.

**Licznik „⏱ N czeka" nie spada**
Sprawdź zasięg. Jeśli internet działa, a licznik stoi ponad dobę — zajrzyj do
tabeli `kwarantanna` w panelu Supabase; tam lądują zapisy, których baza nie
przyjęła.

**Aplikacja pokazuje „ta wersja jest za stara"**
Zapisy nadal działają i nic nie ginie — trzeba tylko zaktualizować aplikację,
żeby znów pobierała dane.

**Chcę zmienić, ile historii trafia na telefony**
Kolumna `okno_dni` w tabeli `warsztaty` (panel Supabase). Telefony przyjmą nową
wartość przy najbliższej synchronizacji i same przytną swoją lokalną bazę.

**Wszystkie warsztaty stoją**
Sprawdź [status.supabase.com](https://status.supabase.com) i czy płatność za
projekt przeszła. Praca offline idzie dalej — zmiany kolejkują się na telefonach
i dojdą po powrocie usługi.
