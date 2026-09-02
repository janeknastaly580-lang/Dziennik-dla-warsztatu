# Model bezpieczeństwa backendu

## Punkt wyjścia: klucz w aplikacji jest publiczny

Klucz `anon` (i `publishable`) jest wbudowany w program i da się go wyjąć
z paczki w kilka minut. Cały model stoi więc na tym, że **ten klucz nie
otwiera niczego**.

## Trzy niezależne warstwy odmowy

**1. RLS bez polityk.** Każda tabela w `public` ma `row level security`
włączone i **zero polityk**. Włączone RLS bez polityki znaczy „odmowa dla
wszystkich". Sprawdzone w bazie: `pg_policies` dla schematu `public` jest
puste, a `rls_enabled = true` na wszystkich 13 tabelach.

**2. Brak uprawnień.** `anon` i `authenticated` mają odebrane `ALL` na
tabelach, sekwencjach i funkcjach — i to samo w `alter default privileges`,
więc dotyczy też tabel, które dopiero powstaną. Sprawdzone: w
`role_table_grants` nie ma **ani jednego** wiersza dla tych ról.

**3. Brak wstępu do schematu.** `revoke usage on schema public from anon,
authenticated` oraz `revoke all on schema public from public` (migracja
`0005` — bez tego `anon` dziedziczyła `USAGE` po roli `PUBLIC`). Klucz
z aplikacji nie zobaczy nawet nazw tabel.

`service_role` ma pełny dostęp (91 uprawnień na tabelach + `USAGE` na
schemacie + `EXECUTE` na funkcjach) i żyje **wyłącznie** w sekretach funkcji
brzegowych oraz w `narzedzia/.env` na komputerze dostawcy.

**Siatka bezpieczeństwa:** event trigger `rls_auto_enable()` włącza RLS
automatycznie na każdej nowo utworzonej tabeli w `public`. Jest `SECURITY
DEFINER`, więc migracja `0009` odebrała mu `EXECUTE` dla `public`, `anon`
i `authenticated` — żeby nie wystawiał się pod `/rest/v1/rpc/`.

**Test:** `supabase/testy/test-anon.ps1` wywołuje REST kluczem `anon` i
sprawdza, że każda tabela odpowiada odmową.

## Uwierzytelnianie: token urządzenia

Nie ma Supabase Auth dla mechaników. Zamiast tego:

- komputer trzyma **token** (64 znaki hex) w DPAPI, baza trzyma **wyłącznie
  jego SHA-256** w `urzadzenia.token_hash`,
- każde żądanie do funkcji brzegowej niesie nagłówek `x-token-urzadzenia`,
- funkcja liczy SHA-256 i woła `uwierzytelnij_urzadzenie(hash, wersja_apl,
  wersja_schematu)`, która zwraca komplet: mechanika, warsztat, rolę,
  nastawy warsztatu i **flagi poleceń zdalnych** (`zablokowane`, `wyczysc`,
  `reset_hasla`),
- ta sama funkcja odnotowuje `ostatni_kontakt_o` i wersję aplikacji.

**Token nie ma daty ważności i nie jest odświeżany** (D1) — brak sieci nie
może nikogo wylogować. Sesję unieważnia wyłącznie administrator.

Rola przychodzi z serwera **przy każdej synchronizacji**, więc odebranie
uprawnień administratora działa natychmiast; komputer nie może sam sobie
przyznać roli.

## Podwójne sprawdzanie uprawnień administratora

Funkcja brzegowa `admin` odrzuca żądanie, jeśli `sesja.rola !==
"administrator"`. Niezależnie od tego **każda** funkcja SQL `admin_*` woła
`sprawdz_admina(p_wykonawca)`, która sama sprawdza rolę i zwraca
`warsztat_id`. Podmiana żądania z komputera zwykłego mechanika nic nie daje.

Dodatkowe blokady wbudowane w funkcje SQL:

- administrator **nie może zablokować samego siebie** ani odciąć własnego stanowiska,
- nie da się zablokować **ostatniego czynnego administratora** warsztatu
  (`zostanie_admin()`),
- wszystko, co robi administrator, ląduje w `dziennik_admina`.

## Kontrola tego, co komputer może zapisać (B13)

Dwie listy dozwolonych kolumn, po obu stronach:

- w funkcji brzegowej `sync` — stała `DOZWOLONE` (funkcja `oczysc()`
  wyrzuca wszystko spoza listy i przycina teksty do 8000 znaków),
- w bazie — funkcja `dozwolone_kolumny(tabela)`, z której korzysta
  `zapisz_z_telefonu()` przy budowaniu dynamicznego SQL.

Komputer może dotknąć wyłącznie tabel `klienci`, `wizyty`,
`dziennik_dostepu` i operacji `wstaw`, `zmien`, `usun`, `scal`.
`warsztat_id` **nigdy** nie pochodzi z żądania — bierze się z sesji.

## Zasada „serwer nigdy nie odrzuca trwałym błędem" (B8)

Zapis, którego nie da się wykonać, **nie** kończy się 4xx. Ląduje
w `kwarantanna`, a komputer dostaje potwierdzenie przyjęcia i idzie dalej.
Kolejka wysyłkowa nigdy nie zatrzymuje się na jednej pozycji. Awaria serwera
to `503 { ponow: true }` — wtedy komputer ponawia, zamiast wyrzucić dane.

Jedyny wyjątek jest zamierzony i jawny: próba usunięcia wizyty przed upływem
karencji zwraca `status: "odmowa"` z powodem — to decyzja, a nie błąd danych.

## Ograniczenie tempa parowania

Tabela `limity` (klucz, licznik, okno czasowe) chroni listę oczekujących
przed zalaniem: zgłoszenia i próby aktywacji zaproszenia mają własne liczniki
w oknie minutowym. Po przekroczeniu funkcja `parowanie` zwraca `429`.

## Logi bez danych osobowych (A11)

Każda funkcja brzegowa loguje wyłącznie JSON z nazwą zdarzenia i liczbami
(`{"f":"sync","zdarzenie":"pull","klienci":12,"wizyty":30}`). W logach nie ma
tokenów, sekretów, nazwisk ani treści zgłoszeń.
