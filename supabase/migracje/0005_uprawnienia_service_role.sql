-- =====================================================================
--  0005  A1 - domkniecie uprawnien
--
--  Migracja 0002 odebrala prawa rolom anon i authenticated, ale rola PUBLIC
--  wciaz miala USAGE na schemacie public (tak jest domyslnie w Postgresie),
--  a anon dziedziczyla to po PUBLIC. Samo USAGE bez praw do tabel niczego nie
--  daje, ale deny-by-default ma byc deny-by-default - odbieramy je jawnie.
--
--  Przy okazji: Edge Functions i panel administratora dzialaja jako
--  service_role i musza miec pelny dostep do danych.
-- =====================================================================

grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all routines in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on routines to service_role;

-- Od tej chwili klucz anon wbudowany w aplikacje mobilna nie widzi nawet
-- nazw tabel. Sprawdzenie: supabase/testy/test-anon.ps1
revoke all on schema public from public;
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;
