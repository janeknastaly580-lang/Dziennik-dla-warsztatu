# Schemat bazy

Wszystko leży w schemacie `public`. Trzynaście tabel, wszystkie z włączonym
RLS i **bez ani jednej polityki** (patrz [02-bezpieczenstwo.md](02-bezpieczenstwo.md)).

Znaczniki czasu są `timestamptz`, identyfikatory to `uuid` (poza dziennikami
i kwarantanną, gdzie licznik `bigint` wystarcza).

## Powiązania

```
warsztaty ──┬── mechanicy ──── urzadzenia
            ├── klienci ────── wizyty
            ├── numeratory     (licznik numerów zleceń: warsztat + rok)
            ├── kwarantanna    (zapisy, których baza nie przyjęła)
            ├── mozliwe_duplikaty
            └── dziennik_dostepu

bez warsztatu: operacje (klucze idempotencji), limity (tempo),
               zaproszenia (kody od dostawcy), dziennik_admina
```

## Tabele danych warsztatu

### `warsztaty`
Jeden wiersz na warsztat. Trzyma **wszystkie nastawy polityki danych**:

| Kolumna | Typ | Znaczenie |
|---|---|---|
| `id` | uuid PK | |
| `nazwa`, `prefiks` | text NOT NULL | prefiks wchodzi w numer zlecenia (`WK/2026/0001`) |
| `okno_dni` | int NOT NULL = 90 | ile historii dostaje komputer przy synchronizacji (A3) |
| `retencja_dni` | int NOT NULL = 365 | po tylu dniach zadanie serwerowe kasuje fizycznie rekordy oznaczone jako usunięte |
| `wygasniecie_offline_dni` | int NOT NULL = 14 | po tylu dniach bez kontaktu komputer kasuje swoją bazę (A4) |
| `karencja_usuwania_dni` | int NOT NULL = 30 | ile dni po „naprawione” wolno usunąć wizytę |
| `utworzono`, `zapisane_o`, `usuniete_o` | timestamptz | |

### `mechanicy`
`id`, `warsztat_id`, `imie`, `rola` (`mechanik` / `administrator`),
`zablokowany_o`, `powod_blokady`, znaczniki czasu.

Administrator jest **dokładnie jeden na warsztat** — pilnuje tego indeks
unikalny (`0010`), a nie tylko interfejs.

### `urzadzenia`
Stanowisko: jeden komputer = jeden wiersz.

| Grupa kolumn | Kolumny |
|---|---|
| parowanie | `kod_parowania`, `sekret_hash`, `kod_wygasa_o`, `imie_zgloszone` |
| przyznanie | `przyznany_o`, `przyznany_przez`, `mechanik_id`, `warsztat_id` |
| sesja | `token_hash` (unikalny), `token_wydany_o` |
| metadane (bez danych osobowych — A11) | `nazwa_urzadzenia`, `platforma`, `wersja_aplikacji`, `wersja_schematu`, `ostatni_kontakt_o`, `ostatnia_sync_o` |
| polecenia zdalne | `zablokowane_o`, `powod_blokady`, `zadanie_wyczyszczenia_o`, `zadanie_resetu_hasla_o` |

`platforma` ma ograniczenie na listę wartości — w bazie wciąż
`('ios','android','web','inne')`, bo migracja `0015` nie została wykonana.

W bazie **nigdy nie leży token ani sekret** — tylko ich SHA-256.

### `klienci`
`id`, `warsztat_id`, `nazwa`, `telefon`, `email`, `adres`, `nip`, `notatki`,
`scalony_z`, `utworzone_przez`, `zmienione_przez`, znaczniki czasu.

Dwie kolumny **generowane i przechowywane**, do wykrywania duplikatów (B3):

- `nazwa_norm` = `norm_tekst(nazwa)` — małe litery bez polskich znaków,
- `telefon_norm` = `norm_telefon(telefon)` — same cyfry, **dziewięć ostatnich**
  (dzięki temu `+48 601-234-567` i `601 234 567` to ten sam numer).

### `wizyty`
`id`, `warsztat_id`, `klient_id`, `auto` (swobodny tekst, bez kartoteki
pojazdów), `auto_norm` (generowana), `tytul`, `opis`, `status`
(`nienaprawione` / `w_trakcie` / `naprawione`), `priorytet`
(`niski` / `normalny` / `wysoki`), `data_wizyty` (date), `data_zamkniecia`,
`przebieg`, `koszt` (`numeric(12,2)`), `numer_roboczy`, `numer_oficjalny`
(unikalny), `naprawione_o`, `utworzone_przez`, `zmienione_przez`, znaczniki.

Ograniczenia wartości pilnuje baza: długości tekstów, `przebieg` 0–3 000 000,
`koszt` 0–10 000 000, dozwolone statusy i priorytety.

**Czego jeszcze nie ma w bazie:** `godzina_od`, `godzina_do` (migracja `0014`).

### `numeratory`
`(warsztat_id, rok)` → `ostatni`. Z tego powstaje **numer oficjalny**
zlecenia. Numer nadaje wyłącznie serwer — dwa warsztaty pracujące offline nie
wygenerują tego samego (B5).

## Tabele techniczne

| Tabela | Do czego |
|---|---|
| `operacje` | klucz idempotencji `<urządzenie>:<pozycja kolejki>` → zapamiętany wynik. Powtórzona wysyłka oddaje ten sam wynik zamiast tworzyć drugi rekord (B12). Klucz: 1–200 znaków |
| `kwarantanna` | zapis, którego baza nie przyjęła: `tabela`, `rekord_id`, `operacja`, `ladunek` (jsonb), `blad`, `przyjete_o`, `rozwiazane_o`. Dzięki niej kolejka na komputerze nigdy się nie zatyka (B8) |
| `mozliwe_duplikaty` | podejrzenie dwóch kartotek tego samego klienta (B3) |
| `dziennik_dostepu` | kto i kiedy otworzył kartotekę albo zgłoszenie (A10) |
| `dziennik_admina` | akcje administratora: blokady, zatwierdzenia, wyrejestrowania |
| `limity` | proste ograniczenie tempa parowania: `klucz`, `licznik`, `okno_do` |
| `zaproszenia` | kody od dostawcy usługi: `kod`, `nazwa_warsztatu`, `prefiks`, `imie`, `rola`, `wygasa_o`, `wykorzystane_o` |

## Triggery

| Trigger | Tabela | Co robi |
|---|---|---|
| `trg_klienci_znaczniki`, `trg_wizyty_znaczniki` | `klienci`, `wizyty` | ustawia `zapisane_o` na `now()` przy każdym zapisie |
| `trg_warsztaty_zapisane`, `trg_mechanicy_zapisane`, `trg_urzadzenia_zapisane`, `trg_dziennik_zapisane` | pozostałe | to samo, prostszą funkcją |
| `trg_wizyty_naprawione` | `wizyty` | zapala `naprawione_o` przy przejściu na status `naprawione` i gasi przy powrocie — od tego znacznika liczy się karencja usuwania |

## Indeksy (najważniejsze)

- `klienci (warsztat_id, nazwa_norm)` i `klienci (warsztat_id, telefon_norm)` — tylko dla nieusuniętych; z nich żyje wykrywanie duplikatów,
- `wizyty (warsztat_id, data_wizyty desc)`, `wizyty (klient_id)`, `wizyty (status)`,
- `wizyty (zapisane_o, id)` i `klienci (zapisane_o, id)` — po nich idzie kursor synchronizacji,
- `urzadzenia (token_hash)` — po nim uwierzytelnia się każde żądanie,
- `numer_oficjalny` unikalny.
