# Build programu na Windows

Aplikacja warsztatu jest zwykłym programem Windows: instalator `.exe`, ikona
w menu Start, okno bez przeglądarki. W środku pracują te same ekrany co
dotychczas (React Native Web budowane przez Expo), a rzeczy, których
przeglądarka dać nie może — **szyfrowana baza SQLCipher** i **klucz w DPAPI** —
robi proces główny w `windows/glowny.js`.

```
frontend/   ekrany (Expo) ──► expo export ──► frontend/dist/
windows/    powłoka Windows (Electron) ──► electron-builder ──► windows/dist/*.exe
```

---

## 1. Czego potrzebujesz raz

| Narzędzie | Wersja | Skąd |
|---|---|---|
| Node.js | 20 LTS lub nowszy | https://nodejs.org (instalator MSI) |
| Git | dowolny | https://git-scm.com |

Nic więcej. Kompilatora C++ **nie potrzebujesz** — SQLCipher instaluje się
z gotowej paczki dla Electrona. (Gdyby kiedyś zabrakło paczki dla nowej wersji
Electrona, dopiero wtedy potrzebne będą „Visual Studio Build Tools" z komponentem
„Desktop development with C++"; instalacja sama powie o tym wprost.)

---

## 2. Build od zera — cztery polecenia

Otwórz PowerShell w katalogu repozytorium i wykonaj po kolei:

```bash
cd frontend; npm install
```

```bash
npm run eksport-web
```

```bash
cd ../windows; npm install
```

```bash
npm run build
```

Gotowe pliki lądują w `windows/dist/`:

| Plik | Do czego |
|---|---|
| `Warsztat-2.0.0-x64.exe` | **instalator** — to rozdajesz mechanikom |
| `Warsztat-2.0.0-przenosny.exe` | wersja przenośna, uruchamia się bez instalacji |
| `win-unpacked/Warsztat.exe` | rozpakowany program do własnych testów |

Instalator waży ok. 95 MB (w środku jest silnik przeglądarki — tak działa każdy
program tego typu: Slack, Teams, VS Code).

> **Kolejność ma znaczenie.** `npm run build` pakuje to, co leży w
> `frontend/dist`. Po każdej zmianie w kodzie ekranów najpierw
> `npm run eksport-web` w `frontend`, dopiero potem build w `windows`.

---

## 3. Instalacja u mechanika

1. Skopiuj `Warsztat-2.0.0-x64.exe` (pendrive, dysk sieciowy, cokolwiek).
2. Uruchom. Windows pokaże **„Windows chronił ten komputer"** — to normalne dla
   programu bez certyfikatu podpisu. Kliknij *Więcej informacji* → *Uruchom mimo
   to*. Ostrzeżenie zniknie dopiero po wykupieniu certyfikatu do podpisywania
   kodu (kilkaset złotych rocznie, opcjonalne).
3. Instalator pyta o katalog i zakłada skrót „Warsztat" w menu Start.
   Instaluje się **dla bieżącego użytkownika**, więc nie potrzebuje uprawnień
   administratora Windows.
4. Przy pierwszym uruchomieniu program pokazuje ekran parowania — mechanik
   podaje imię i nazwisko, administrator warsztatu zatwierdza stanowisko na
   swoim ekranie „Dostęp". Do tego jednego kroku potrzebny jest internet.

Dane trafiają do `%APPDATA%\Warsztat`:

| Plik | Zawartość |
|---|---|
| `warsztat.db` | baza warsztatu, zaszyfrowana SQLCipher |
| `klucze.json` | klucz do bazy i token urządzenia, zaszyfrowane DPAPI |

Oba są czytelne **wyłącznie dla tego konta Windows na tym komputerze**.
Skopiowanie ich na inny komputer daje szyfrogram.

---

## 4. Praca nad kodem

```bash
cd frontend; npm run web
```

Podgląd w przeglądarce na `http://localhost:8081`. Zmiany widać od razu, ale
**nie ma tam szyfrowania** (przeglądarka nie ma DPAPI ani SQLCipher) — aplikacja
mówi o tym pomarańczowym paskiem. To tryb do oglądania interfejsu, nie do pracy
na prawdziwych danych klientów.

Żeby zobaczyć te same zmiany w prawdziwym oknie programu, przy działającym
`npm run web` uruchom w drugim oknie:

```bash
cd windows; npm run dev
```

Program wczyta ekrany prosto z Metro — z pełnym szyfrowaniem i przeładowaniem
po zapisaniu pliku.

Sprawdzenie typów przed buildem:

```bash
cd frontend; npm run typy
```

---

## 5. Nowa wersja programu

1. Podnieś `version` w `frontend/package.json`, `frontend/app.json`
   i `windows/package.json` (te trzy liczby mają być takie same).
2. `npm run eksport-web` w `frontend`, `npm run build` w `windows`.
3. Rozdaj nowy instalator — instaluje się na starym, dane w `%APPDATA%\Warsztat`
   zostają nietknięte.

Program **nie aktualizuje się sam**. To świadoma decyzja: automatyczna
aktualizacja wymagałaby serwera z podpisanymi paczkami, a w warsztacie na kilka
stanowisk nowy plik `.exe` rozchodzi się szybciej niż konfiguracja takiego
serwera.

---

## 6. Gdy coś nie działa

| Objaw | Przyczyna i co zrobić |
|---|---|
| Okno puste albo „Page could not be found" | brak `frontend/dist` — wykonaj `npm run eksport-web` i zbuduj ponownie |
| „Nie udało się otworzyć danych" przy starcie | program jest już uruchomiony w drugim oknie (baza jest na wyłączność) — zamknij tamto okno |
| Synchronizacja milczy, dane nie wychodzą | zmieniony adres Supabase — dopisz jego domenę do `POLITYKA` w `windows/glowny.js`, inaczej blokuje ją polityka bezpieczeństwa treści |
| `npm install` w `windows/` kończy się błędem kompilacji | brak gotowej paczki SQLCipher dla Twojej wersji Electrona — zainstaluj „Visual Studio Build Tools" z komponentem C++ i powtórz |
| Instalator nie chce się uruchomić na komputerze mechanika | SmartScreen — *Więcej informacji* → *Uruchom mimo to* (patrz punkt 3) |

---

## 7. Co trzeba zrobić po stronie serwera

Przejście na Windows dodaje jedną migrację — bez niej pierwsze parowanie
stanowiska odbije się od ograniczenia w bazie:

```
supabase/migracje/0015_stanowiska_windows.sql
```

Wykonaj ją w panelu Supabase (SQL Editor) i przewdroż funkcję brzegową
`parowanie` — reszta procedury jest w [DO-ZROBIENIA-RECZNIE.md](DO-ZROBIENIA-RECZNIE.md).
