# Funkcje w bazie

W schemacie `public` jest **37 funkcji**. Wszystkie mają ustawiony
`search_path` (`pg_catalog` albo `pg_catalog, public`) i wszystkie poza
`rls_auto_enable()` są `SECURITY INVOKER` — działają z prawami wołającego,
czyli `service_role` z funkcji brzegowej.

## Pomocnicze

| Funkcja | Zwraca | Co robi |
|---|---|---|
| `norm_tekst(text)` | text | małe litery bez polskich znaków — do `nazwa_norm`, `auto_norm` |
| `norm_telefon(text)` | text | same cyfry, dziewięć ostatnich — do `telefon_norm` |
| `wolny_prefiks(text)` | text | wolny prefiks numeracji dla nowego warsztatu |
| `zostanie_admin(warsztat, bez)` | bool | czy po zablokowaniu wskazanego mechanika zostanie jakiś administrator |
| `sprawdz_admina(wykonawca)` | uuid | rzuca wyjątek, jeśli wykonawca nie jest czynnym administratorem; zwraca jego `warsztat_id` |

## Sesja i zapis danych

### `uwierzytelnij_urzadzenie(token_hash, wersja_apl, wersja_schematu) → jsonb`
Serce uwierzytelniania. Po `token_hash` znajduje urządzenie i zwraca:
`urzadzenie_id`, `mechanik_id`, `mechanik_imie`, `rola`, `warsztat_id`,
`warsztat_nazwa`, `prefiks`, `okno_dni`, `wygasniecie_offline_dni`,
`zablokowane`, `powod_blokady`, `wyczysc`, `reset_hasla`, `znalezione`.
Przy okazji odnotowuje `ostatni_kontakt_o` i wersję aplikacji.

`zablokowane` jest prawdą, gdy zablokowano urządzenie **albo** mechanika
**albo** cokolwiek z tego zostało usunięte — jedna flaga zamiast czterech
sprawdzeń po stronie klienta.

### `zapisz_z_telefonu(urzadzenie, mechanik, warsztat, klucz, tabela, rekord, operacja, pola, zrobione_o) → jsonb`
Jedyna droga zapisu. Realizuje naraz:

- **B12** — jeśli `klucz` już był, oddaje zapamiętany wynik z `operacje`
  z dopiskiem `powtorka: true`,
- **B13** — dozwolone tylko `klienci`/`wizyty`/`dziennik_dostepu` i cztery
  operacje; kolumny filtruje `dozwolone_kolumny()`,
- **B6** — `zrobione_o` nigdy nie wyprzedza zegara serwera
  (`least(p_zrobione_o, now())`),
- **B1** — `UPDATE` obejmuje wyłącznie kolumny przysłane w `pola`; SQL
  budowany jest dynamicznie z rzutowaniem `($1->>'kolumna')::typ_kolumny`,
- **B2** — `usun` ustawia `usuniete_o = now()`, nigdy `DELETE`,
- **B5** — przy pierwszym wstawieniu wizyty nadaje `numer_oficjalny`,
- **B3** — po wstawieniu klienta szuka duplikatu po `telefon_norm` /
  `nazwa_norm` i odkłada podejrzenie do `mozliwe_duplikaty`,
- **karencja** (wersja z `0013`) — `usun` na wizycie pyta
  `mozna_usunac_wizyte()`; odmowa wraca jako `status: 'odmowa'` z powodem,
  **bez** kwarantanny,
- **B8** — każdy wyjątek SQL jest łapany, rekord idzie do `kwarantanna`,
  a funkcja kończy się poprawnie ze `status: 'kwarantanna'`.

Operacja `scal` przepina wizyty na kartotekę docelową, oznacza źródłową jako
`scalony_z` + usuniętą i zamyka wpisy w `mozliwe_duplikaty`.

Wynik każdej operacji trafia do `operacje` (klucz idempotencji).

### `dozwolone_kolumny(tabela) → text[]`
Lista kolumn, które komputer w ogóle może przysłać. Stan w bazie:

- `klienci`: `nazwa, telefon, email, adres, nip, notatki`
- `wizyty`: `klient_id, auto, tytul, opis, status, priorytet, data_wizyty,
  data_zamkniecia, przebieg, koszt, numer_roboczy`

(Migracja `0014` dopisuje tu `godzina_od`, `godzina_do` — jeszcze niewykonana.)

### `do_kwarantanny(...) → void`
Wkłada odrzucony ładunek do `kwarantanna` z obciętym komunikatem błędu.

### `nadaj_numer(warsztat) → text`
Podbija `numeratory` dla `(warsztat, rok)` i składa `PREFIKS/ROK/0001`.

### `mozna_usunac_wizyte(wizyta) → jsonb`
`{ mozna: bool, powod: text, wolno_od: timestamptz }`. Wolno usunąć wyłącznie
wizytę `naprawione`, po `karencja_usuwania_dni` od `naprawione_o`.

## Odczyt (wąskie okno synchronizacji — A3)

| Funkcja | Co zwraca |
|---|---|
| `pobierz_klientow(warsztat, kursor_ts, kursor_id, limit)` | `SETOF klienci` tego warsztatu, po `(zapisane_o, id)`, limit 1–2000 |
| `pobierz_wizyty(warsztat, okno_dni, kursor_ts, kursor_id, limit)` | `SETOF wizyty` z ostatnich `okno_dni` **plus wszystkie nadal otwarte**, ten sam kursor |

Kursor jest parą `(zapisane_o, id)` — dzięki temu strony nie gubią ani nie
dublują rekordów przy równoległych zapisach.

## Parowanie i zaproszenia

| Funkcja | Co robi |
|---|---|
| `utworz_zaproszenie(nazwa_warsztatu, imie, prefiks, dni_waznosci, warsztat_id, rola)` | kod dostawcy: zakłada nowy warsztat albo dokłada osobę do istniejącego |
| `aktywuj_zaproszenie(urzadzenie, kod)` | zużywa kod, tworzy warsztat i konto administratora, przypina urządzenie |
| `przyznaj_dostep(kod, mechanik, kto)` | przypisuje zgłoszenie o danym kodzie do wskazanego mechanika |
| `admin_zatwierdz_urzadzenie(wykonawca, kod)` | **jeden klik**: zakłada konto z `imie_zgloszone` i od razu przyznaje dostęp |
| `admin_przyznaj_dostep(wykonawca, kod, mechanik)` | to samo, ale do istniejącego konta |
| `admin_dodaj_mechanika(wykonawca, imie, rola)` | ręczne dodanie osoby |

Token urządzenia wydaje funkcja brzegowa `parowanie`, nie SQL — baza dostaje
tylko jego hash.

## Polecenia zdalne (A4, A6)

| Funkcja | Skutek |
|---|---|
| `zablokuj_urzadzenie(urzadzenie, powod, kto, wyczysc)` | `zablokowane_o` + opcjonalnie `zadanie_wyczyszczenia_o`; **token zostaje**, żeby komputer poznał powód |
| `zablokuj_mechanika(mechanik, powod, kto, wyczysc)` | to samo dla konta i wszystkich jego stanowisk |
| `odblokuj_urzadzenie` / `odblokuj_mechanika` | zdejmuje blokadę i polecenie czyszczenia bez ponownego parowania |
| `wyrejestruj_urzadzenie(urzadzenie, kto)` | kasuje `token_hash`, `kod_parowania`, `sekret_hash`, ustawia `usuniete_o` — powrót wymaga parowania od nowa |
| `wymus_nowe_haslo(urzadzenie, kto)` | `zadanie_resetu_hasla_o`; program przy najbliższym kontakcie prosi o nowe hasło |
| `admin_*` (5 funkcji) | wersje powyższych z `sprawdz_admina()` i blokadami „nie na sobie", „nie ostatni administrator" |

Każda z nich dopisuje wiersz do `dziennik_admina`.

## Panel administratora

### `dane_administracyjne(wykonawca) → jsonb`
Jedno wywołanie, komplet dla ekranu „Dostęp": lista `oczekujace`
(kod, `imie_zgloszone`, nazwa urządzenia, platforma, czas zgłoszenia) oraz
lista `mechanicy` z ich urządzeniami, stanem blokady, ostatnią synchronizacją
i flagą `czeka_na_haslo`.

### `stan_systemu() → jsonb`, `raport_synchronizacji() → TABLE`
Diagnostyka dla dostawcy: liczby rekordów, wpisy w kwarantannie, stanowiska
milczące dłużej niż dobę.

## Retencja

### `zadanie_retencji() → jsonb`
Uruchamiane codziennie o 3:17 przez `pg_cron`. Kasuje **fizycznie**:

1. wizyty oznaczone jako usunięte dawniej niż `retencja_dni` warsztatu,
2. kartoteki klientów bez żadnej pozostałej wizyty (i bez scaleń na nie),
3. klucze idempotencji starsze niż 30 dni,
4. rozwiązaną kwarantannę starszą niż 90 dni,
5. dziennik dostępu starszy niż 12 miesięcy, dziennik administratora — 24 miesiące,
6. niesparowane zgłoszenia z wygasłym kodem,
7. wygasłe liczniki tempa.

Zwraca podsumowanie: `{ kiedy, wizyty, klienci, pozostale }`.

## Triggery

`trg_znaczniki()`, `trg_zapisane_o()` — ustawiają `zapisane_o`.
`trg_wizyty_naprawione()` — zapala i gasi `naprawione_o` przy zmianie statusu.
`rls_auto_enable()` — event trigger włączający RLS na nowych tabelach
(jedyna funkcja `SECURITY DEFINER`).
