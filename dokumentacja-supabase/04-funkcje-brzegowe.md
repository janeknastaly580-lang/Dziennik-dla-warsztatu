# Funkcje brzegowe — kontrakty HTTP

Trzy funkcje, wszystkie `POST`, wszystkie z `verify_jwt = false` (uwierzytelnianie
jest własne, nagłówkiem `x-token-urzadzenia`), wszystkie z tymi samymi
nagłówkami CORS i `Cache-Control: no-store`.

Adres: `https://<projekt>.supabase.co/functions/v1/<nazwa>`

Każda tworzy klienta Supabase kluczem `service_role` ze zmiennych środowiskowych
`SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` — klucz nigdy nie opuszcza Supabase.

---

## `sync` — jedyna droga danych

**Nagłówek:** `x-token-urzadzenia` (min. 32 znaki). Bez niego `401 BRAK_TOKENU`.

Każde żądanie zaczyna się od `uwierzytelnij_urzadzenie(sha256(token))` i może
skończyć się zanim dojdzie do akcji:

| Sytuacja | Odpowiedź |
|---|---|
| token nieznany | `401 { kod: "NIEZNANY_TOKEN" }` |
| polecenie wyczyszczenia | `403 { kod: "WYCZYSC", powod }` |
| blokada | `403 { kod: "ZABLOKOWANE", powod }` |
| urządzenie bez mechanika/warsztatu | `403 { kod: "NIEPRZYPISANE" }` |
| awaria po stronie serwera | `503 { kod: "BLAD_SERWERA", ponow: true }` |

Do każdej udanej odpowiedzi dokładany jest **blok wspólny**: `serwer_czas`,
`wersja_schematu`, `wymaga_aktualizacji`, `mechanik { id, imie, rola }`,
`warsztat { id, nazwa, prefiks, okno_dni }`, `polecenia { reset_hasla }`,
`wygasniecie_offline_dni`. Stąd program wie o roli administratora i o żądaniu
zmiany hasła.

### `{ akcja: "stan" }`
Sam blok wspólny. Program używa tego jako lekkiego „czy jesteśmy odcięci".

### `{ akcja: "pull", kursory, limit }`
`kursory` to `{ klienci: {ts, id} | null, wizyty: {ts, id} | null }`,
`limit` 1–1000 (domyślnie 500).

Zwraca `klienci`, `wizyty`, nowe `kursory`, `okno_od` (data graniczna okna)
oraz `wiecej: boolean` — czy trzeba powtórzyć `pull`. Odnotowuje
`ostatnia_sync_o`.

**B10:** aplikacja starsza niż `MIN_WERSJA_SCHEMATU` dostaje
`200 { ok: false, kod: "WYMAGANA_AKTUALIZACJA" }` — **ale jej zapisy są nadal
przyjmowane**. Nikt nie traci pracy przez to, że nie zaktualizował programu.

### `{ akcja: "push", zmiany: [...] }`
Maksymalnie **200** zmian na żądanie (powyżej: `413 ZA_DUZO_ZMIAN`).

Każda zmiana: `{ id_lokalne, tabela, rekord_id, operacja, pola, zrobione_o }`.

Przetwarzanie jednej pozycji:

1. `oczysc(tabela, pola)` — zostają wyłącznie kolumny z listy `DOZWOLONE`,
   teksty przycięte do 8000 znaków (dla `scal` przepuszczane jest samo
   `docelowy`),
2. klucz idempotencji `"<urzadzenie_id>:<id_lokalne>"` (max 200 znaków),
3. kontrola wstępna: znana tabela, znana operacja, `rekord_id` jest UUID —
   jeśli nie, pozycja **ląduje w kwarantannie**, a nie w błędzie,
4. `zapisz_z_telefonu(...)`,
5. jakikolwiek wyjątek → `do_kwarantanny(...)` i `status: "kwarantanna"`.

Odpowiedź: `200 { ok: true, ...wspolne, wyniki: [{ id_lokalne, status, ... }] }`,
gdzie `status` to `ok`, `kwarantanna`, `odmowa` (karencja usuwania) albo
`scalone`. Przy `ok` dla nowej wizyty dochodzi `numer_oficjalny`.

**Lista `DOZWOLONE` w kodzie repozytorium** (wdrożona wersja nie ma jeszcze godzin):

```
klienci:          nazwa, telefon, email, adres, nip, notatki
wizyty:           klient_id, auto, tytul, opis, status, priorytet, data_wizyty,
                  godzina_od, godzina_do, data_zamkniecia, przebieg, koszt,
                  numer_roboczy
dziennik_dostepu: akcja, klient_id, wizyta_id
```

---

## `parowanie` — dwie drogi wejścia

Bez tokenu (poza `haslo_ustawione`). Ograniczenie tempa przez tabelę `limity`.

### `{ akcja: "zglos", imie, nazwa_urzadzenia, platforma, wersja_aplikacji, wersja_schematu }`
Zakłada wiersz w `urzadzenia` z ośmioznakowym **kodem** (alfabet bez
mylących znaków: brak `I`, `O`, `0`, `1`) i 256-bitowym **sekretem**.
W bazie ląduje wyłącznie `sha256(sekret)`.

Zwraca `{ id, kod, sekret, wygasa_o }`. Kod mechanik pokazuje administratorowi,
sekret zostaje na komputerze. Przy zalaniu: `429 ZA_DUZO_ZGLOSZEN`.

Platforma jest walidowana listą — w kodzie repozytorium `["windows","web"]`,
wszystko inne zapisuje się jako `inne`.

### `{ akcja: "aktywuj_zaproszenie", id, sekret, kod }`
Droga dla pierwszej osoby w warsztacie. Sprawdza sekret, woła
`aktywuj_zaproszenie()`, która zakłada warsztat i konto administratora.
`429 ZA_DUZO_PROB` przy zbyt wielu próbach.

### `{ akcja: "sprawdz", id, sekret }`
Odpytywane co 5 sekund przez ekran parowania.

- brak zgody: `200 { status: "oczekuje" | "wygasl" }`
- blokada: `403 { kod: "ZABLOKOWANE", powod }`
- zgoda: **jednorazowo** wydaje token — generuje go funkcja brzegowa, zapisuje
  `token_hash`, kasuje `kod_parowania` i `sekret_hash`, po czym zwraca
  `200 { status: "przyznany", token, urzadzenie_id, mechanik, warsztat, ... }`.
  Powtórne wywołanie: `409 TOKEN_JUZ_WYDANY`.

Nieznane `id` i zły sekret dają **tę samą** odpowiedź (`404 NIEZNANE_ZGLOSZENIE`)
— nie ma jak wybadać, które kody istnieją.

### `{ akcja: "haslo_ustawione" }` (z nagłówkiem tokenu)
Gasi `zadanie_resetu_hasla_o`.

---

## `admin` — uprawnienia administratora

Wymaga tokenu **i** roli `administrator` (`403 BRAK_UPRAWNIEN`). Każda akcja
woła funkcję SQL, która sprawdza rolę drugi raz.

| Akcja | Ciało | Funkcja SQL |
|---|---|---|
| `dane` | — | `dane_administracyjne` |
| `zatwierdz` | `kod` | `admin_zatwierdz_urzadzenie` |
| `przyznaj` | `kod`, `mechanik_id` | `admin_przyznaj_dostep` |
| `dodaj_mechanika` | `imie`, `rola` | `admin_dodaj_mechanika` |
| `zablokuj_mechanika` | `mechanik_id`, `powod` | `admin_zablokuj_mechanika` |
| `odblokuj_mechanika` | `mechanik_id` | `admin_odblokuj_mechanika` |
| `urzadzenie` | `urzadzenie_id`, `co` (`zablokuj`/`odblokuj`/`wyrejestruj`/`reset_hasla`), `powod` | `admin_urzadzenie` |

Błędy wejścia wracają jako `200 { ok: false, blad: "..." }` — ekran pokazuje
je jako komunikat, nie jako awarię.
