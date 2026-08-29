# Umowy powierzenia przetwarzania (DPA) — co podpisać

Podmiot przetwarzający to każdy, kto przetwarza dane Twoich klientów **w Twoim
imieniu**. Bez podpisanej umowy powierzenia (art. 28 RODO) korzystanie z takiego
dostawcy jest naruszeniem — niezależnie od tego, jak dobrze zabezpieczony jest
system.

## Dobra wiadomość: jest tylko jeden dostawca

Architektura tego systemu została celowo uproszczona. Nie ma tu Cloudflare R2,
nie ma PowerSync, nie ma osobnego magazynu zdjęć — bo **nie ma zdjęć**.
Łańcuch sub‑procesorów sprowadza się do jednego podmiotu.

| Dostawca | Co przetwarza | Region | DPA | Status |
|---|---|---|---|---|
| **Supabase Inc.** | Baza danych klientów i zleceń, funkcje serwerowe, logi | eu-central-1 (Frankfurt, AWS) | <https://supabase.com/legal/dpa> | ☐ do podpisania |
| `[biuro rachunkowe]` | Dane z faktur | `[…]` | umowa własna | ☐ |
| `[operator telefonii — jeśli SMS-y do klientów]` | Numery telefonów | `[…]` | umowa własna | ☐ |

**Sub‑procesorzy Supabase** (informacyjnie, akceptujesz ich razem z DPA):
Amazon Web Services (infrastruktura), Cloudflare (warstwa sieciowa dostawcy),
oraz dostawcy narzędzi operacyjnych wymienieni na
<https://supabase.com/legal/subprocessors>.

## Jak podpisać DPA z Supabase

1. Zaloguj się na <https://supabase.com/dashboard>.
2. *Organization Settings* → *Legal Documents* → **Data Processing Addendum**.
3. Wypełnij dane firmy (nazwa, adres, osoba kontaktowa) i zaakceptuj.
4. **Pobierz podpisany dokument PDF i zachowaj go** razem z rejestrem
   czynności. Zrzut ekranu nie wystarczy.
5. Odhacz pozycję w tabeli wyżej i wpisz datę.

Data podpisania: `[………]`

## Ryzyko rezydualne — świadoma decyzja

Supabase i AWS to spółki amerykańskie. Amerykański **CLOUD Act** teoretycznie
pozwala organom USA żądać danych od amerykańskiej spółki, także gdy serwer stoi
w Unii. Region UE, standardowe klauzule umowne i podpisane DPA ograniczają to
ryzyko, ale go nie usuwają.

Wyeliminować całkowicie da się je wyłącznie przez self‑hosting u dostawcy
z UE — co przenosi na Ciebie utrzymanie, aktualizacje bezpieczeństwa i kopie
zapasowe. Dla warsztatu samochodowego przetwarzającego dane kontaktowe
i opisy usterek (bez danych szczególnych kategorii) **przyjęcie tego ryzyka
jest uzasadnione**. Zapisz tę decyzję — świadoma akceptacja ryzyka jest
elementem rozliczalności z art. 5 ust. 2 RODO.

Decyzję podjął: `[imię i nazwisko]`, data: `[………]`
