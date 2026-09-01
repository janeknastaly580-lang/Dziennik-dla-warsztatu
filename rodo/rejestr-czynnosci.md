# Rejestr czynności przetwarzania — system warsztatu

> Szablon do uzupełnienia. Miejsca oznaczone `[…]` wypełnij danymi swojej firmy.
> Art. 30 RODO. Rejestr trzyma się na piśmie (może być elektronicznie)
> i pokazuje na żądanie UODO.

**Data ostatniej aktualizacji:** `[data]`

---

## 1. Administrator danych

| Pole | Wartość |
|---|---|
| Nazwa | `[pełna nazwa firmy]` |
| Adres | `[adres]` |
| NIP | `[NIP]` |
| Kontakt w sprawach danych | `[imię i nazwisko, e-mail, telefon]` |
| Inspektor Ochrony Danych | `[nie wyznaczono / dane IOD]` |

> Warsztat samochodowy prowadzący zwykłą kartotekę klientów zwykle **nie musi**
> wyznaczać IOD. Jeśli nie wyznaczasz — wpisz „nie wyznaczono” i tyle.

---

## 2. Czynność przetwarzania: obsługa zleceń serwisowych

| Pole | Wartość |
|---|---|
| **Cel** | Przyjęcie pojazdu do naprawy, prowadzenie dokumentacji zlecenia, kontakt z klientem, rozliczenie usługi, obsługa reklamacji i gwarancji |
| **Podstawa prawna** | art. 6 ust. 1 lit. b RODO (wykonanie umowy o naprawę) — dla danych kontaktowych i opisu zlecenia; art. 6 ust. 1 lit. c (obowiązki podatkowe i rachunkowe) — dla danych na fakturze; art. 6 ust. 1 lit. f (prawnie uzasadniony interes: obrona przed roszczeniami) — dla historii napraw |
| **Kategorie osób** | Klienci warsztatu (osoby fizyczne i osoby kontaktowe firm) |
| **Kategorie danych** | Imię i nazwisko lub nazwa firmy, telefon, e‑mail, adres, NIP, notatki, opis pojazdu wpisany swobodnym tekstem (marka, model, numer rejestracyjny), opis usterki, przebieg, koszt naprawy, daty |
| **Dane szczególnych kategorii** | **Nie są przetwarzane.** System nie przechowuje zdjęć ani żadnych plików — nie ma więc wizerunku ani danych lokalizacyjnych. |
| **Odbiorcy** | Podmiot przetwarzający: Supabase (hosting bazy danych, region UE — Frankfurt). Poza tym: `[biuro rachunkowe, jeśli dotyczy]` |
| **Przekazanie poza EOG** | Dane są przechowywane w regionie UE. Supabase jest spółką amerykańską — ryzyko rezydualne wynikające z CLOUD Act zostało przyjęte świadomie, na podstawie DPA i standardowych klauzul umownych. |
| **Termin usunięcia** | Rekord oznaczony jako usunięty jest fizycznie kasowany po `[365]` dniach (ustawienie „retencja” w panelu administratora). Dane niezbędne do celów podatkowych — 5 lat od końca roku podatkowego. |
| **Środki techniczne i organizacyjne** | Patrz sekcja 4. |

---

## 3. Czynność przetwarzania: dostęp pracowników do systemu

| Pole | Wartość |
|---|---|
| **Cel** | Kontrola dostępu do danych klientów i możliwość odtworzenia, kto miał wgląd w daną kartotekę |
| **Podstawa prawna** | art. 6 ust. 1 lit. f RODO (prawnie uzasadniony interes: bezpieczeństwo danych powierzonych warsztatowi) |
| **Kategorie osób** | Mechanicy i personel warsztatu |
| **Kategorie danych** | Imię i nazwisko mechanika, identyfikator urządzenia, model komputera i wersja aplikacji, znaczniki czasu logowania i otwierania kartotek |
| **Odbiorcy** | Supabase (hosting) |
| **Termin usunięcia** | Dziennik dostępu: 12 miesięcy. Dziennik działań administratora: 24 miesiące. Kasowane automatycznie. |

> Pracownicy muszą być **poinformowani**, że wglądy w kartoteki są zapisywane.
> To warunek legalności tego przetwarzania — wpisz to do regulaminu pracy albo
> odrębnej informacji.

---

## 4. Środki techniczne i organizacyjne

**Techniczne** (wdrożone w systemie — szczegóły w `BEZPIECZENSTWO.md`):

- Baza z włączonym Row Level Security bez żadnych polityk zezwalających;
  klucz publiczny wbudowany w aplikację mobilną nie odczytuje żadnych danych
  (weryfikowane skryptem `supabase/testy/test-anon.ps1`).
- Dostęp aplikacji wyłącznie przez funkcje serwerowe sprawdzające token
  urządzenia; token przyznaje imiennie administrator i może go odebrać zdalnie.
- Blokada aplikacji hasłem lub biometrią, automatyczna po 5 minutach
  bezczynności i przy przejściu w tło.
- Komputer bez kontaktu z serwerem przez `[14]` dni kasuje lokalną kopię danych.
- Wyłączone kopie zapasowe aplikacji do iCloud i Google Drive.
- Ograniczenie zakresu danych na komputerze do `[90]` dni historii oraz zleceń
  otwartych.
- Rejestr dostępu do kartotek (kto, kiedy, którą otworzył).
- Brak funkcji masowego eksportu danych w aplikacji mobilnej.
- Logi i komunikaty błędów pozbawione danych osobowych.
- Szyfrowanie transmisji (HTTPS/TLS).
- Cotygodniowa kopia zapasowa przechowywana poza infrastrukturą dostawcy.

**Organizacyjne** (do wdrożenia po Twojej stronie):

- Upoważnienia do przetwarzania danych dla mechaników — `[data nadania]`
- Umowy o zachowaniu poufności — `[data podpisania]`
- Procedura offboardingu: blokada konta w panelu **w dniu zakończenia pracy**
- Komputery służbowe z wymuszonym kodem blokady ekranu
- Szkolenie: nie wynosimy danych, nie robimy zdjęć kartotek, nie przesyłamy
  danych klientów prywatnymi komunikatorami

---

## 5. Historia zmian rejestru

| Data | Kto | Co się zmieniło |
|---|---|---|
| `[data]` | `[kto]` | Utworzenie rejestru |
