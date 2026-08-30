# Co musisz zrobić sam

Wszystko, co dało się zrobić w Supabase i w kodzie — jest zrobione i sprawdzone.
Tu została lista czynności wymagających Twojego konta, podpisu albo decyzji.

**Nic nie jest hostowane na Twoim komputerze.** Cały system to Supabase (baza +
funkcje brzegowe) i aplikacja na telefonach. Katalog `narzedzia/` to skrypty
odpalane z ręki kilka razy w życiu projektu — nie serwer.

---

## 🔴 1. Zbuduj APK — 30 minut

To jest teraz najważniejszy krok. Build robi się **w chmurze EAS**; na Twoim
komputerze zostaje tylko polecenie, które go zleca.

```bash
cd frontend
npx eas login
npx eas build:configure
npx eas build --platform android --profile preview
```

`preview` daje plik **.apk** do zainstalowania wprost na telefonach warsztatu
(profil jest już w `eas.json`). Po zakończeniu EAS poda link do pobrania.

### Dlaczego nie Expo Go

Trzy zabezpieczenia działają **wyłącznie we własnym buildzie**:

| Co | Dlaczego Expo Go nie wystarcza |
|---|---|
| Szyfrowanie lokalnej bazy (SQLCipher) | to natywna opcja kompilacji `expo-sqlite` |
| Wyłączenie kopii do iCloud / Google Drive | wtyczka działa przy `prebuild`, nie w Expo Go |
| Zablokowane uprawnienia aparatu i lokalizacji | to wpisy w manifeście |

W Expo Go baza klientów byłaby nieszyfrowana i wylądowałaby w prywatnej chmurze
mechanika. Używaj go wyłącznie do własnych prób, nigdy z prawdziwymi danymi.

### Weryfikacja po zbudowaniu

**Android** — na gotowym `.apk`:

```bash
aapt2 dump xmltree app.apk --file AndroidManifest.xml | findstr allowBackup
```

Musi być `android:allowBackup=false`. *(Na poziomie konfiguracji już
sprawdzone: `expo config --type introspect` pokazuje `allowBackup: 'false'`,
`fullBackupContent: 'false'` i `dataExtractionRules`.)*

**iOS** — po `npx expo prebuild -p ios` otwórz `ios/<nazwa>/AppDelegate.swift`
i sprawdź, czy w `didFinishLaunchingWithOptions` jest blok z komentarzem
`warsztat-a12-bez-kopii`. Jeśli wtyczka wypisała ostrzeżenie „Nie rozpoznano
AppDelegate", wklej ręcznie na początku tej funkcji:

```swift
if var katalogDanych = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
  var wartosci = URLResourceValues()
  wartosci.isExcludedFromBackup = true
  try? katalogDanych.setResourceValues(wartosci)
}
```

---

## 🔴 2. Uruchom pierwszy warsztat

Kod zaproszenia dla pierwszego warsztatu jest **już wystawiony**:

```
V8KH-ZN9K-LM3X          ważny do 29.10.2026
Warsztat · administrator: „Administrator warsztatu"
```

Kolejne wystawiasz tak:

```bash
cd narzedzia
npm run zaproszenie -- "Warsztat u Kowalskiego" "Jan Kowalski" --prefiks WK --dni 30
```

Przebieg u klienta — **bez Twojego udziału po przekazaniu kodu**:

```
1. Właściciel instaluje APK, otwiera aplikację
2. Dotyka „Mam kod zaproszenia", wpisuje kod
   → aplikacja zakłada warsztat i jego konto ADMINISTRATORA
3. Ustawia dowolne własne hasło
4. Mechanik uruchamia aplikację na swoim telefonie → widzi 8-znakowy KOD
5. Podaje kod właścicielowi (telefonicznie, SMS-em, jakkolwiek)
6. Właściciel: ikona klucza ⚿ → wpisuje kod → wybiera mechanika → Przyznaj
7. Telefon mechanika w kilka sekund prosi o ustawienie własnego hasła
```

Kod zaproszenia jest **jednorazowy**. Kto go użyje, zostaje administratorem
tego warsztatu — przekazuj go tak, jak przekazujesz hasło.

**Pierwszą synchronizację rób po Wi-Fi** — wtedy telefon ściąga większą paczkę.

---

## 🟠 3. Test akceptacyjny sesji offline *(ryzyko D1)*

Ten test decyduje, czy wolno wdrożyć system u klienta. Wykonaj dokładnie:

1. Sparuj telefon, ustaw hasło, sprawdź że widzisz klientów.
2. Włącz **tryb samolotowy**.
3. **Zabij aplikację** (usuń z listy zadań, nie tylko zminimalizuj).
4. Odczekaj **2 godziny** (albo przesuń zegar telefonu do przodu).
5. Otwórz aplikację.

| Co widzisz | Werdykt |
|---|---|
| Ekran hasła, a po jego podaniu **wszystkie dane** | ✅ wdrażasz |
| Ekran parowania („podaj kod administratorowi") | ❌ **nie wdrażasz** |
| Pusta lista klientów | ❌ **nie wdrażasz** |

Przy okazji: dodaj klienta w trybie samolotowym → ma się zapisać i pokazać
„⏱ czeka na wysłanie". Wyłącz tryb samolotowy → licznik ma spaść do zera
w ciągu ~2 minut.

---

## 🟠 4. Zatwierdź zmiany w repozytorium *(ryzyko A2)*

Skaner sekretów i hook `pre-commit` są już **zainstalowane i sprawdzone** —
`narzedzia/.env` z kluczem `service_role` jest poprawnie wykluczony
z repozytorium, a commit zawierający taki klucz zostanie zablokowany.

Zostało tylko zatwierdzenie reorganizacji (`backend/` → `narzedzia/`, nowe
migracje, ekran administratora):

```bash
git add -A
git commit -m "Administrator w aplikacji, SQLCipher, usuniecie panelu lokalnego"
```

Hook uruchomi się sam i przepuści commit, jeśli nic wrażliwego nie wycieka.
Sprawdzenie na żądanie:

```bash
cd narzedzia && npm run skanuj
```

---

## 🟠 5. Wymuś blokadę ekranu na telefonach *(ryzyko A4)*

Lokalna baza jest szyfrowana SQLCipherem, a klucz leży w Keychain / Keystore.
**Keystore chroni klucz tylko wtedy, gdy telefon ma ustawiony PIN lub odcisk
palca.** Bez tego cała warstwa szyfrowania jest do obejścia.

Na każdym telefonie służbowym ustaw kod blokady i włącz biometrię.

---

## 🟡 6. Konto Supabase i kopie zapasowe *(C1, C2)*

- <https://supabase.com/dashboard/account/security> → **włącz MFA**
- Sprawdź, czy karta płatnicza jest aktualna (nieudana płatność = wstrzymany
  projekt = wszystkie warsztaty stoją)
- [Database → Backups](https://supabase.com/dashboard/project/tpigqlvwjatlkhfqtlkt/database/backups)
  → potwierdź codzienne kopie, rozważ **PITR**

Własna kopia poza Supabase:

```bash
cd narzedzia
npm run kopia
```

Plik ląduje w `kopie/`. **Skopiuj go poza ten komputer i poza Supabase.**
Kopia obok oryginału nie jest kopią zapasową. Ustaw cotygodniowe przypomnienie.

**Przetestuj odtwarzanie, zanim będzie potrzebne:**

1. Załóż drugi, pusty projekt Supabase.
2. Wykonaj na nim migracje z `supabase/migracje/` po kolei (0001…0011).
3. Podmień `SUPABASE_URL` w `narzedzia/.env` na projekt testowy.
4. `npm run przywroc -- kopie/plik.json --na-sucho`, potem bez `--na-sucho`.
5. Sprawdź liczniki, wróć do `.env` produkcyjnego.

---

## 🟡 7. Sprawy formalne — RODO

### DPA z Supabase *(A14, A15)*

<https://supabase.com/dashboard> → *Organization Settings* → *Legal Documents*
→ **Data Processing Addendum** → wypełnij dane firmy → **pobierz PDF**.

Szczegóły: [rodo/umowy-powierzenia.md](rodo/umowy-powierzenia.md).

### Uzupełnij szablony w `rodo/`

| Plik | Co zrobić |
|---|---|
| [rejestr-czynnosci.md](rodo/rejestr-czynnosci.md) | dane administratora, terminy retencji |
| [klauzula-informacyjna.md](rodo/klauzula-informacyjna.md) | uzupełnij i **wywieś w punkcie przyjęć** |
| [procedura-naruszenia.md](rodo/procedura-naruszenia.md) | osoby odpowiedzialne, **wydrukuj** |
| [umowy-powierzenia.md](rodo/umowy-powierzenia.md) | odhacz DPA po podpisaniu |

Procedurę naruszenia trzymaj tam, gdzie znajdziesz ją **bez dostępu do
komputera**. W kryzysie masz 72 godziny.

### Twoja rola prawna

Uwaga na rozróżnienie, bo zmienia obowiązki:

- **Warsztat** jest administratorem danych swoich klientów.
- **Ty** jesteś podmiotem przetwarzającym — dostarczasz oprogramowanie
  i zarządzasz infrastrukturą.

Potrzebujesz więc **umowy powierzenia z każdym warsztatem** (Ty jako procesor),
a Supabase jest Twoim sub-procesorem. Umowę tę musisz przygotować sam —
szablon w `rodo/` opisuje relację warsztat ↔ Supabase, nie warsztat ↔ Ty.

### Umowy z mechanikami — po stronie warsztatu

Przekaż klientowi, że musi mieć: NDA z mechanikami, upoważnienia do
przetwarzania danych i **poinformować ich**, że wglądy w kartoteki są
zapisywane w dzienniku dostępu.

---

## 🟢 8. Przenieś stare dane *(jednorazowo, jeśli dotyczy)*

```bash
cd narzedzia
npm run migruj                  # podgląd
npm run migruj -- --zapisz      # przenos
```

Skrypt nie rusza starej bazy. Zdjęcia z `dane/pliki` **nie są przenoszone** —
uzasadnienie w [dane/README.md](dane/README.md).

---

## 🟢 9. Nawyk: test klucza publicznego po każdej zmianie schematu *(A1)*

Nowa tabela bez RLS to najczęstsza przyczyna wycieków z Supabase.

```bash
powershell -ExecutionPolicy Bypass -File supabase\testy\test-anon.ps1
```

Wynik ma brzmieć `WYNIK: czysto`. Cokolwiek innego — nie wdrażasz.
Raz na jakiś czas zajrzyj też do **Advisors → Security** w panelu Supabase.
Wpisy `rls_enabled_no_policy` (INFO) są **zamierzone** — to znaczy „odmowa dla
wszystkich".

---

## Czego świadomie nie ma — i dlaczego

- **Wersja webowa aplikacji.** W przeglądarce nie istnieje Keychain/Keystore,
  więc token urządzenia, hasło i klucz szyfrowania bazy nie miałyby gdzie
  bezpiecznie leżeć. To był powód błędu `wa-sqlite.wasm` na `localhost:8081` —
  target `web` został usunięty, bo połowa modelu bezpieczeństwa tam nie
  działa. Cel to APK/IPA.
- **Panel administratora na Twoim komputerze.** Zarządzanie dostępem żyje
  w aplikacji, pod rolą `administrator`. Nic nie musi być uruchomione, żeby
  warsztat pracował.
- **Detekcja root/jailbreak** — na zrootowanym telefonie każde zabezpieczenie
  po stronie aplikacji da się obejść. Realną obroną jest wąskie okno danych
  (90 dni), szyfrowana baza i możliwość odcięcia telefonu zdalnie.
- **Zadanie w tle wysyłające kolejkę** — przy kolejce tekstowej (brak zdjęć)
  i synchronizacji co 2 minuty nie daje korzyści, a dokłada uprawnień
  i zużycia baterii.
- **PowerSync i Cloudflare R2** — niepotrzebne. Synchronizacja jest własna,
  magazyn plików odpadł razem ze zdjęciami. Dwóch sub-procesorów mniej.
