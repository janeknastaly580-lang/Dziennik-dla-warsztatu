-- =====================================================================
--  0002  A1 + A2:  RLS deny-by-default na KAZDEJ tabeli
--
--  Model bezpieczenstwa tego projektu:
--
--   * Klucz `anon` jest wbudowany w aplikacje mobilna i jest PUBLICZNY.
--     Kazdy, kto rozpakuje .apk, ma go w reku. Dlatego rola `anon` nie
--     ma prawa dotknac zadnej tabeli: ani przez RLS (brak polityk), ani
--     przez uprawnienia (REVOKE), ani nawet do schematu (REVOKE USAGE).
--
--   * Nie ma ANI JEDNEJ polityki RLS. Wlaczone RLS bez polityki oznacza
--     "odmowa dla wszystkich" - to jest wlasnie deny-by-default.
--     Kazda nowa tabela musi przejsc przez ten sam blok (patrz ponizej
--     ALTER DEFAULT PRIVILEGES + test z pliku testy/test-anon.ps1).
--
--   * Caly dostep aplikacji mobilnej idzie przez Edge Functions, ktore
--     dzialaja z kluczem service_role po stronie serwera i sprawdzaja
--     token urzadzenia. Klucz service_role NIGDY nie trafia do aplikacji
--     (A2) - siedzi tylko w sekretach Edge Functions i w .env panelu
--     administratora na komputerze w warsztacie.
-- =====================================================================

-- 1. RLS na kazdej tabeli w schemacie public - bez wyjatkow
do $blok$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$blok$;

-- 2. Zero polityk. Gdyby jakas powstala przypadkiem - kasujemy.
do $blok$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$blok$;

-- 3. Odebranie uprawnien rolom publicznym (druga, niezalezna warstwa).
--    Nawet gdyby ktos w przyszlosci dodal polityke RLS przez pomylke,
--    brak GRANT-ow i brak USAGE na schemacie i tak zablokuje odczyt.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;

-- 4. To samo dla tabel i funkcji, ktore dopiero powstana.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on routines  from anon, authenticated;

-- 5. Nie uzywamy Supabase Auth dla mechanikow (D1: token urzadzenia nie
--    wygasa, wiec brak sieci nikogo nie wylogowuje). Zeby nikt nie zalozyl
--    konta "bokiem", schemat auth tez nie jest wystawiony dla anona -
--    to ustawienie projektu, patrz DO-ZROBIENIA-RECZNIE.md.

comment on schema public is
  'Deny-by-default: RLS wlaczone na kazdej tabeli, zero polityk, anon i authenticated bez USAGE. Dostep wylacznie przez Edge Functions z service_role.';
