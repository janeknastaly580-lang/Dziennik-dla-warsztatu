-- =====================================================================
--  0007  B3 - wykrywanie duplikatow nie dzialalo dla numerow z prefiksem
--
--  "+48 601-234-567" po odrzuceniu nie-cyfr daje 48601234567, a "601 234 567"
--  daje 601234567. Dla bazy byly to dwa rozne numery, wiec duplikat kartoteki
--  przechodzil niezauwazony - a przy zakladaniu offline nic sie nie nadpisuje,
--  wiec system nie mial jak zglosic bledu. Polskie numery maja 9 cyfr:
--  bierzemy 9 ostatnich i prefiks kraju przestaje mieć znaczenie.
--
--  Kolumna telefon_norm jest generowana i stored, wiec trzeba ja zdjac,
--  podmienic funkcje i zalozyc od nowa - baza przeliczy wartosci sama.
-- =====================================================================

drop index if exists public.idx_klienci_telefon_norm;
alter table public.klienci drop column if exists telefon_norm;

create or replace function public.norm_telefon(t text)
returns text language sql immutable
set search_path = pg_catalog
as $fn$
  select case when c is null then null
              when length(c) > 9 then right(c, 9)
              else c end
  from (select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '') as c) s
$fn$;

alter table public.klienci
  add column telefon_norm text generated always as (public.norm_telefon(telefon)) stored;

create index idx_klienci_telefon_norm
  on public.klienci (warsztat_id, telefon_norm) where usuniete_o is null;
