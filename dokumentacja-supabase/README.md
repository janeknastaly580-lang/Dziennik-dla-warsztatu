# Supabase — opis stanu, jaki zastaliśmy

**Data spisania:** 2026-09-01 · **Commit:** `faa0c44` · **Projekt:** `tpigqlvwjatlkhfqtlkt`
(region `eu-central-1`, Frankfurt)

Ten katalog jest **zamrożonym zdjęciem** tego, jak backend działa **przed**
upraszczaniem kodu. Opisuje stan **faktyczny** — nie tylko to, co leży
w repozytorium: schemat, funkcje, uprawnienia i harmonogram zostały odczytane
wprost z działającej bazy.

> **Tego katalogu się nie zmienia.** Ma służyć jako punkt odniesienia: po
> każdym uproszczeniu można sprawdzić, czy zachowanie systemu jest nadal to
> samo. Jeśli coś w backendzie zmieni się naprawdę, opisuje to osobny,
> nowy dokument — nie ten.

## Co gdzie

| Plik | Zawartość |
|---|---|
| [01-schemat-bazy.md](01-schemat-bazy.md) | 13 tabel, kolumny, klucze, indeksy, triggery, kolumny generowane |
| [02-bezpieczenstwo.md](02-bezpieczenstwo.md) | deny-by-default, uprawnienia ról, uwierzytelnianie tokenem, limity tempa |
| [03-funkcje-sql.md](03-funkcje-sql.md) | 37 funkcji w bazie — sygnatury i co robią |
| [04-funkcje-brzegowe.md](04-funkcje-brzegowe.md) | `sync`, `parowanie`, `admin` — pełne kontrakty HTTP |
| [05-przeplywy.md](05-przeplywy.md) | parowanie, synchronizacja, administracja, retencja — krok po kroku |

## Stan wdrożenia w chwili spisania

**Migracje wykonane na projekcie (14):**
`0001_schemat`, `0002_rls_deny_by_default`, `0003_funkcje_synchronizacji`,
`0004_retencja_i_zadania`, `0005_uprawnienia_service_role`,
`0006_luzniejszy_klucz_idempotencji`, `0007_normalizacja_telefonu`,
`0008_blokada_zachowuje_token`, `0009_zamkniecie_rls_auto_enable`,
`0010_administrator_w_aplikacji`, `0011_funkcje_administratora`,
`0012_zatwierdzanie_jednym_klikiem`, `0012_karencja_usuwania_wizyt`,
`0013_zapis_z_telefonu_z_karencja`.

**Migracje leżące w repozytorium, ale NIEWYKONANE:**

| Plik | Co dodaje | Skutek braku |
|---|---|---|
| `0014_termin_wizyty.sql` | kolumny `godzina_od`, `godzina_do` w `wizyty` + ograniczenie kolejności + indeks + nowa lista dozwolonych kolumn | godziny wizyt **nie wyjdą** poza komputer — zapis z godzinami wpada do kwarantanny |
| `0015_stanowiska_windows.sql` | `windows` na liście dozwolonych wartości `urzadzenia.platforma` | pierwsze parowanie stanowiska zapisze `inne` albo odbije się od ograniczenia |

**Funkcje brzegowe (wszystkie `ACTIVE`, `verify_jwt = false`):**
`parowanie` (wersja 3), `sync` (wersja 2), `admin` (wersja 2).
Kod w repozytorium jest **nowszy** niż wdrożony: `sync` ma już `godzina_od` /
`godzina_do` na liście dozwolonych kolumn, a `parowanie` przyjmuje platformę
`windows`. Do działania kalendarza trzeba wykonać obie migracje i przewdrożyć
te dwie funkcje.

**Rozszerzenia:** `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`,
`supabase_vault`, `pg_cron`.

**Harmonogram:** jedno zadanie `pg_cron` — `retencja-warsztat`, codziennie
`17 3 * * *`, wywołuje `select public.zadanie_retencji()`.

**Dane w bazie w chwili spisania:** 1 warsztat, 5 mechaników, 6 urządzeń,
4 klientów, 11 wizyt, 149 wpisów idempotencji, 113 wpisów dziennika dostępu,
11 wpisów dziennika administratora, 2 rekordy w kwarantannie, 7 zaproszeń.

## Zasada, z której wynika cała reszta

Dostawca usługi **nie hostuje niczego u siebie**. Działający system to
Supabase i komputery w warsztacie. Aplikacja nigdy nie rozmawia z bazą wprost:
każde żądanie idzie do funkcji brzegowej, która sprawdza token urządzenia
i dopiero wtedy sięga do danych kluczem `service_role`, żyjącym wyłącznie po
stronie Supabase.
