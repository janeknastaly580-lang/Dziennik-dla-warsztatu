-- =====================================================================
--  0012  Wizyte mozna usunac dopiero 30 dni po oznaczeniu jej jako
--        naprawiona.
--
--  Po co: historia napraw jest dowodem przy reklamacji i sporze. Skasowanie
--  jej w emocjach albo przez pomylke jest nieodwracalne dla warsztatu.
--  Karencja daje czas na refleksje, a jednoczesnie pozwala posprzatac stare,
--  zamkniete zgloszenia.
--
--  Skutek uboczny, swiadomie przyjety: zgloszenia OTWARTEGO nie da sie
--  usunac wcale. Pomylke poprawia sie edycja albo zamknieciem jako
--  naprawione - nie kasowaniem.
--
--  Regula stoi w BAZIE, a nie tylko w aplikacji. Telefon ja zna (kolumna
--  `naprawione_o` jedzie w synchronizacji) i chowa przycisk, ale podmieniony
--  zapis z telefonu tez sie o nia rozbije - patrz migracja 0013.
-- =====================================================================

alter table public.wizyty add column if not exists naprawione_o timestamptz;

-- Uzupelnienie dla wizyt juz zamknietych: bierzemy date zamkniecia,
-- a gdy jej brak - moment ostatniego zapisu.
update public.wizyty
   set naprawione_o = coalesce(data_zamkniecia::timestamptz, zapisane_o)
 where status = 'naprawione' and naprawione_o is null;

create index if not exists idx_wizyty_naprawione_o
  on public.wizyty (warsztat_id, naprawione_o) where usuniete_o is null;

-- Trigger pilnuje znacznika niezaleznie od tego, ktora droga przyszla zmiana
-- statusu (aplikacja, SQL Editor, skrypt migracyjny).
create or replace function public.trg_wizyty_naprawione()
returns trigger language plpgsql set search_path = pg_catalog, public as $fn$
begin
  if new.status = 'naprawione' then
    -- Pierwsze zamkniecie ustawia zegar. Ponowne zapisy go nie przesuwaja,
    -- zeby edycja opisu nie wydluzala karencji.
    if new.naprawione_o is null then
      new.naprawione_o := now();
    end if;
  else
    -- Otwarcie z powrotem kasuje zegar - karencja liczy sie od nowa.
    new.naprawione_o := null;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_wizyty_naprawione on public.wizyty;
create trigger trg_wizyty_naprawione before insert or update on public.wizyty
  for each row execute function public.trg_wizyty_naprawione();

-- Ile dni karencji - ustawienie warsztatu, zmienialne bez nowej wersji apki.
alter table public.warsztaty add column if not exists karencja_usuwania_dni integer;
update public.warsztaty set karencja_usuwania_dni = 30 where karencja_usuwania_dni is null;
alter table public.warsztaty alter column karencja_usuwania_dni set default 30;
alter table public.warsztaty alter column karencja_usuwania_dni set not null;
alter table public.warsztaty drop constraint if exists warsztaty_karencja_check;
alter table public.warsztaty add constraint warsztaty_karencja_check
  check (karencja_usuwania_dni between 0 and 3650);

-- Jedno miejsce z odpowiedzia "czy wolno skasowac te wizyte".
-- Aplikacja liczy to samo u siebie (repozytorium.ts -> ocenUsuwanieWizyty),
-- zeby ekran dzialal bez zasiegu, ale ostatnie slowo ma ta funkcja.
create or replace function public.mozna_usunac_wizyte(p_wizyta uuid)
returns jsonb language plpgsql stable
set search_path = pg_catalog, public as $fn$
declare
  v_status text;
  v_naprawione timestamptz;
  v_karencja integer;
  v_wolno_od timestamptz;
begin
  select wi.status, wi.naprawione_o, wa.karencja_usuwania_dni
    into v_status, v_naprawione, v_karencja
    from public.wizyty wi
    join public.warsztaty wa on wa.id = wi.warsztat_id
   where wi.id = p_wizyta;

  if v_status is null then
    return jsonb_build_object('mozna', false, 'powod', 'Nie ma takiego zgloszenia');
  end if;

  v_karencja := coalesce(v_karencja, 30);

  if v_status <> 'naprawione' then
    return jsonb_build_object('mozna', false,
      'powod', 'Usunac mozna wylacznie zgloszenie oznaczone jako naprawione');
  end if;

  v_wolno_od := coalesce(v_naprawione, now()) + make_interval(days => v_karencja);

  if now() < v_wolno_od then
    return jsonb_build_object('mozna', false, 'wolno_od', v_wolno_od,
      'powod', format('Zgloszenie mozna usunac dopiero %s dni po oznaczeniu jako naprawione',
                      v_karencja));
  end if;

  return jsonb_build_object('mozna', true);
end $fn$;

grant execute on all routines in schema public to service_role;
