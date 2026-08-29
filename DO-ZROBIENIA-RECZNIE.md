# Co musisz zrobić sam

Wszystko, co dało się zrobić w Supabase i w kodzie — jest zrobione i sprawdzone.
Tu została lista czynności, których **nie da się wykonać za Ciebie**: wymagają
Twojego konta, Twojego podpisu albo Twojej decyzji.

Kolejność ma znaczenie. Punkty 1–3 to warunek uruchomienia czegokolwiek.

---

## 🔴 ZANIM URUCHOMISZ — 15 minut

### 1. Wklej klucz `service_role` do `backend/.env`

To jedyna rzecz, której nie mogłem zrobić: klucz `service_role` nie jest
udostępniany narzędziom automatycznym — i dobrze, bo omija wszystkie
zabezpieczenia bazy.

1. Wejdź na <https://supabase.com/dashboard/project/tpigqlvwjatlkhfqtlkt/settings/api-keys>
2. Znajdź **`service_role`** → **Reveal** → skopiuj.
3. Otwórz `backend/.env` i wklej po znaku `=`:

```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

**Nigdzie indziej.** Nie w `frontend/app.json`, nie w kodzie aplikacji, nie
w wiadomości na czacie. Plik `.env` jest już w `.gitignore`.

### 2. Zmień hasło do panelu

W `backend/.env` jest wygenerowane hasło startowe:

```
HASLO_PANELU=q6UdvI1m33b-C5X4
```

**Zmień je na własne** i zapisz w menedżerze haseł. Panel stoi na `127.0.0.1`,
więc nie jest widoczny z sieci, ale za nim siedzi klucz z punktu 1.

Sprawdź, że wszystko działa:

```bash
cd backend
npm install
npm start
```

W konsoli ma się pojawić `Połączenie z bazą OK`. Otwórz <http://127.0.0.1:4000>.

### 3. Załóż repozytorium i zainstaluj skaner sekretów  *(ryzyko A2)*

Projekt **nie jest jeszcze repozytorium gita**. Bez tego nie ma hooka
`pre-commit`, a historia gita pamięta wszystko, co raz do niej trafi.

```bash
cd "C:\dev\Nowy folder (5)"
git init
cd backend
npm run skanuj -- --hook
```

Skaner ma wypisać `czysto` i zainstalować hook. Od tej pory commit z kluczem
`service_role`, hasłem w URL‑u Postgresa albo kluczem prywatnym zostanie
zablokowany.

---

## 🟠 PRZED WDROŻENIEM DO WARSZTATU

### 4. Zbuduj własną aplikację — Expo Go nie wystarczy  *(ryzyko A12)*

Wtyczka wyłączająca kopie zapasowe do iCloud i Google Drive działa dopiero
w prawdziwym buildzie. W Expo Go **nie działa** — czyli baza klientów wyląduje
w prywatnej chmurze mechanika.

```bash
cd frontend
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
```

(Jeśli nie masz jeszcze EAS: `npx eas login`, potem `npx eas build:configure`.)

Expo Go używaj wyłącznie do własnych prób, nigdy do pracy z prawdziwymi
danymi klientów.

### 5. Zweryfikuj, że kopie zapasowe są faktycznie wyłączone  *(A12)*

**Nie zakładaj, że jest — sprawdź.** Lista ryzyk mówi o tym wprost.

**Android** — na zbudowanym pliku `.apk`:

```bash
# w Android SDK build-tools
aapt2 dump xmltree app.apk --file AndroidManifest.xml | findstr allowBackup
```

Musi być `android:allowBackup=false`. *(Sprawdzone już na poziomie
konfiguracji — `npx expo config --type introspect` pokazuje `allowBackup:
'false'`, `fullBackupContent: 'false'` i `dataExtractionRules`. Zostaje
potwierdzenie na gotowej paczce.)*

**iOS** — po `npx expo prebuild -p ios` otwórz
`ios/<nazwa>/AppDelegate.swift` i sprawdź, czy w
`didFinishLaunchingWithOptions` jest wstawiony blok z komentarzem
`warsztat-a12-bez-kopii` i `isExcludedFromBackup = true`.

Jeśli wtyczka wypisała w konsoli ostrzeżenie „Nie rozpoznano AppDelegate”,
dodaj ten fragment ręcznie na początku `didFinishLaunchingWithOptions`:

```swift
if var katalogDanych = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
  var wartosci = URLResourceValues()
  wartosci.isExcludedFromBackup = true
  try? katalogDanych.setResourceValues(wartosci)
}
```

### 6. Test akceptacyjny sesji offline  *(ryzyko D1 — najważniejszy test)*

Ten test decyduje, czy w ogóle wolno Ci wdrożyć system. Wykonaj dokładnie:

1. Sparuj telefon, ustaw hasło, wejdź do aplikacji, sprawdź że widzisz klientów.
2. Włącz **tryb samolotowy**.
3. **Zabij aplikację** (nie tylko zminimalizuj — usuń z listy zadań).
4. Odczekaj **2 godziny** (albo cofnij zegar telefonu o kilka godzin do przodu).
5. Otwórz aplikację.

| Co widzisz | Werdykt |
|---|---|
| Ekran hasła, a po jego podaniu **wszystkie dane** | ✅ wdrażasz |
| Ekran parowania („podaj kod administratorowi”) | ❌ **nie wdrażasz** |
| Pusta lista klientów | ❌ **nie wdrażasz** |

Przy okazji sprawdź: dodaj klienta w trybie samolotowym → ma się zapisać
i pokazać „⏱ czeka na wysłanie”. Wyłącz tryb samolotowy → licznik ma spaść
do zera w ciągu ~2 minut.

### 7. Wymuś blokadę ekranu na telefonach służbowych  *(ryzyko A4)*

Systemowe szyfrowanie pamięci na Androidzie i iOS działa **tylko wtedy, gdy
telefon ma ustawiony PIN lub odcisk palca**. Bez tego cała warstwa szyfrowania
jest bezwartościowa.

Na każdym telefonie służbowym ustaw kod blokady i włącz biometrię.
Aplikacja doda do tego własną blokadę po 5 minutach bezczynności — ale nie
zastąpi systemowej.

### 8. Włącz MFA na koncie Supabase i sprawdź kopie zapasowe  *(C1, C2)*

- <https://supabase.com/dashboard/account/security> → **Enable MFA**.
- Sprawdź, czy karta płatnicza jest aktualna (nieudana płatność = wstrzymany
  projekt).
- <https://supabase.com/dashboard/project/tpigqlvwjatlkhfqtlkt/database/backups>
  → potwierdź, że codzienne kopie są włączone. Rozważ **PITR** (płatny
  dodatek) — pozwala cofnąć bazę do dowolnej minuty, a nie tylko do wczoraj.

### 9. Zrób własną kopię i **przetestuj jej odtworzenie**  *(C1)*

Kopia nieprzetestowana to nie kopia.

```bash
cd backend
npm run kopia
```

Plik ląduje w `kopie/warsztat-RRRR-MM-DD-....json`. **Skopiuj go poza ten
komputer i poza Supabase** — dysk zewnętrzny, inna chmura, cokolwiek. Kopia
obok oryginału nie jest kopią zapasową.

Teraz **sprawdź odtwarzanie**, zanim będzie potrzebne:

1. Załóż w Supabase **drugi, pusty projekt testowy**.
2. Wykonaj na nim migracje z `supabase/migracje/` (SQL Editor, po kolei 0001…0009).
3. Podmień `SUPABASE_URL` w `backend/.env` na projekt testowy.
4. `npm run przywroc -- kopie/plik.json --na-sucho`, potem bez `--na-sucho`.
5. Sprawdź w panelu, że liczniki się zgadzają. Wróć do `.env` produkcyjnego.

Ustaw sobie **cotygodniowe przypomnienie** na `npm run kopia`.

---

## 🟡 SPRAWY FORMALNE — RODO

### 10. Podpisz DPA z Supabase  *(A14, A15)*

<https://supabase.com/dashboard> → *Organization Settings* → *Legal Documents*
→ **Data Processing Addendum** → wypełnij dane firmy → pobierz PDF i zachowaj.

Szczegóły i lista sub‑procesorów: [rodo/umowy-powierzenia.md](rodo/umowy-powierzenia.md).

### 11. Uzupełnij dokumenty w katalogu `rodo/`  *(A15)*

Szablony są gotowe, brakuje w nich tylko danych Twojej firmy (miejsca `[…]`):

| Plik | Co zrobić |
|---|---|
| [rodo/rejestr-czynnosci.md](rodo/rejestr-czynnosci.md) | wpisz dane administratora, terminy retencji |
| [rodo/klauzula-informacyjna.md](rodo/klauzula-informacyjna.md) | uzupełnij i **wywieś w punkcie przyjęć** |
| [rodo/procedura-naruszenia.md](rodo/procedura-naruszenia.md) | wpisz osoby odpowiedzialne i **wydrukuj** |
| [rodo/umowy-powierzenia.md](rodo/umowy-powierzenia.md) | odhacz DPA po podpisaniu |

Procedurę naruszenia wydrukuj i trzymaj tam, gdzie znajdziesz ją **bez dostępu
do komputera**. W kryzysie masz 72 godziny i zwykle nie masz spokoju na
czytanie z ekranu.

### 12. Umowy z mechanikami  *(A10, A13)*

- Umowa o zachowaniu poufności (NDA) z każdym mechanikiem.
- Upoważnienie do przetwarzania danych osobowych.
- **Poinformuj pracowników**, że wglądy w kartoteki są zapisywane w dzienniku
  dostępu — bez tej informacji samo logowanie dostępu jest wątpliwe prawnie.
- Zdecyduj: telefony służbowe czy prywatne (BYOD). Rekomendacja: **służbowe**.

---

## 🟢 URUCHOMIENIE WARSZTATU

### 13. Przenieś stare dane  *(jednorazowo)*

```bash
cd backend
npm run migruj                  # podgląd
npm run migruj -- --zapisz      # przenos
```

Skrypt nie rusza starej bazy — `dane/warsztat.db` zostaje na miejscu.
Zdjęcia z `dane/pliki` **nie są przenoszone**; po sprawdzeniu, że nie są
potrzebne, skasuj je (uzasadnienie w [dane/README.md](dane/README.md)).

### 14. Dodaj mechaników i sparuj telefony

W panelu (<http://127.0.0.1:4000>):

1. **Ustawienia** → sprawdź warsztat „Warsztat” (prefiks `W1`). Możesz zmienić
   okno synchronizacji i retencję. Dodaj kolejne warsztaty, jeśli są.
2. **Dostęp** → dodaj mechaników (imię i nazwisko + warsztat).
3. Mechanik otwiera aplikację i czyta Ci **kod z ekranu** (8 znaków).
4. Wpisujesz kod, wybierasz mechanika, **Przyznaj dostęp**.
5. Telefon w kilka sekund prosi mechanika o ustawienie **dowolnego** hasła.

**Pierwszą synchronizację zrób po Wi‑Fi** — to jedyny moment, w którym telefon
ściąga większą paczkę danych *(D2, D3)*.

### 15. Nawyk: test klucza publicznego po każdej zmianie schematu  *(A1)*

Nowa tabela bez RLS to najczęstsza przyczyna wycieków z Supabase. Po **każdej**
zmianie w bazie:

```bash
powershell -ExecutionPolicy Bypass -File supabase\testy\test-anon.ps1
```

Wynik ma brzmieć `WYNIK: czysto`. Cokolwiek innego — nie wdrażasz.

Do tego raz na jakiś czas: panel Supabase → **Advisors → Security**.
Wpisy `rls_enabled_no_policy` (poziom INFO) są **zamierzone** — to właśnie
oznacza „odmowa dla wszystkich”.

### 16. Rytm pracy administratora

| Kiedy | Co |
|---|---|
| Codziennie rano | panel → **Stan**: czy któryś telefon nie milczy > 24 h; czy kwarantanna jest pusta |
| Gdy pojawi się duplikat | panel → **Duplikaty**, mechanik scala kartoteki w aplikacji |
| Co tydzień | `npm run kopia` i wyniesienie pliku poza ten komputer |
| W dniu odejścia pracownika | panel → **Dostęp** → „Zablokuj dostęp”. Nie następnego dnia. |
| Po zmianie schematu bazy | test z punktu 15 |

---

## Czego świadomie nie ma — i dlaczego

Żebyś nie szukał tego w kodzie:

- **Szyfrowanie pliku SQLite (SQLCipher)** — `expo-sqlite` tego nie ma;
  wymagałoby zamiany biblioteki na `op-sqlite` i własnego builda. Zamiast tego:
  wymuszona blokada aplikacji, auto‑wipe po 14 dniach, wyłączone kopie zapasowe,
  klucze w Keychain „tylko to urządzenie” i systemowe szyfrowanie dysku
  (punkt 7). Jeśli chcesz SQLCipher — to jedna, dobrze odizolowana zmiana
  w `frontend/src/dane/baza.ts`.
- **Detekcja root/jailbreak** — na zrootowanym telefonie każde zabezpieczenie
  po stronie aplikacji da się obejść. Dawałaby złudne poczucie bezpieczeństwa
  zamiast realnej ochrony; realną obroną jest mała ilość danych na telefonie
  i możliwość odcięcia go zdalnie.
- **Zadanie w tle wysyłające kolejkę bez otwierania aplikacji** — przy
  kolejce tekstowej (brak zdjęć) i synchronizacji co 2 minuty w trakcie pracy
  nie daje realnej korzyści, a dokłada uprawnień i zużycia baterii.
- **PowerSync i Cloudflare R2** — niepotrzebne. Synchronizacja jest własna
  (pełna kontrola nad regułami z A3 i kolejką z B8), a magazyn plików odpadł
  razem ze zdjęciami. Dwóch sub‑procesorów mniej do rozliczenia w RODO.
