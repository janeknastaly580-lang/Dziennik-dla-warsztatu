-- =====================================================================
--  0004  Zadania serwerowe: retencja, sprzatanie, monitoring
--
--   B2  fizyczne kasowanie robi WYLACZNIE zadanie serwerowe, po uplywie
--       okresu retencji ustawionego dla warsztatu
--   B8  raport o wpisach czekajacych w kwarantannie i o telefonach,
--       ktore od doby nic nie przyslaly
--   A15 ograniczenie przechowywania danych = wymog RODO, nie tylko higiena
-- =====================================================================

create or replace function public.zadanie_retencji()
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  v_wizyty  integer := 0;
  v_klienci integer := 0;
  v_reszta  integer := 0;
  v_n       integer;
begin
  -- 1. Wizyty oznaczone jako usuniete dawniej niz retencja warsztatu.
  --    Kolejnosc ma znaczenie: najpierw dzieci, potem rodzice.
  with usuwane as (
    delete from public.wizyty w
     using public.warsztaty s
     where s.id = w.warsztat_id
       and w.usuniete_o is not null
       and w.usuniete_o < now() - make_interval(days => s.retencja_dni)
    returning 1
  )
  select count(*) into v_wizyty from usuwane;

  -- 2. Kartoteki klientow bez zadnej pozostalej wizyty.
  with usuwane as (
    delete from public.klienci k
     using public.warsztaty s
     where s.id = k.warsztat_id
       and k.usuniete_o is not null
       and k.usuniete_o < now() - make_interval(days => s.retencja_dni)
       and not exists (select 1 from public.wizyty w where w.klient_id = k.id)
       and not exists (select 1 from public.klienci d where d.scalony_z = k.id)
    returning 1
  )
  select count(*) into v_klienci from usuwane;

  -- 3. Klucze idempotencji starsze niz 30 dni (B12 - ponowienie po
  --    miesiacu i tak juz nie nastapi).
  delete from public.operacje where kiedy < now() - interval '30 days';
  get diagnostics v_n = row_count; v_reszta := v_reszta + v_n;

  -- 4. Rozwiazana kwarantanna starsza niz 90 dni.
  delete from public.kwarantanna
   where rozwiazane_o is not null and rozwiazane_o < now() - interval '90 days';
  get diagnostics v_n = row_count; v_reszta := v_reszta + v_n;

  -- 5. Dziennik dostepu - 12 miesiecy wystarcza do wyjasnienia incydentu.
  delete from public.dziennik_dostepu where kiedy < now() - interval '12 months';
  get diagnostics v_n = row_count; v_reszta := v_reszta + v_n;

  delete from public.dziennik_admina where kiedy < now() - interval '24 months';
  get diagnostics v_n = row_count; v_reszta := v_reszta + v_n;

  -- 6. Niesparowane zgloszenia urzadzen z wygaslym kodem.
  delete from public.urzadzenia
   where przyznany_o is null and token_hash is null
     and kod_wygasa_o is not null and kod_wygasa_o < now() - interval '1 day';
  get diagnostics v_n = row_count; v_reszta := v_reszta + v_n;

  -- 7. Wygasle liczniki ograniczania tempa.
  delete from public.limity where okno_do < now() - interval '1 day';
  get diagnostics v_n = row_count; v_reszta := v_reszta + v_n;

  return jsonb_build_object(
    'kiedy', now(), 'wizyty', v_wizyty, 'klienci', v_klienci, 'pozostale', v_reszta);
end
$fn$;

-- ---------------------------------------------------------------------
--  B8  Raport zdrowia synchronizacji - panel administratora odpytuje go
--      i zapala alarm, gdy telefon milczy dluzej niz dobe albo gdy cos
--      czeka w kwarantannie.
-- ---------------------------------------------------------------------
create or replace function public.raport_synchronizacji()
returns table (
  urzadzenie_id     uuid,
  mechanik          text,
  platforma         text,
  wersja_aplikacji  text,
  ostatnia_sync_o   timestamptz,
  godzin_bez_sync   numeric,
  zablokowane       boolean,
  w_kwarantannie    bigint
)
language sql stable
set search_path = pg_catalog, public
as $fn$
  select u.id,
         coalesce(m.imie, '(nieprzypisane)'),
         u.platforma,
         u.wersja_aplikacji,
         u.ostatnia_sync_o,
         round((extract(epoch from now() - coalesce(u.ostatnia_sync_o, u.token_wydany_o, u.utworzono)) / 3600.0)::numeric, 1),
         (u.zablokowane_o is not null),
         (select count(*) from public.kwarantanna q
           where q.urzadzenie_id = u.id and q.rozwiazane_o is null)
    from public.urzadzenia u
    left join public.mechanicy m on m.id = u.mechanik_id
   where u.usuniete_o is null and u.token_hash is not null
   order by coalesce(u.ostatnia_sync_o, u.token_wydany_o, u.utworzono) asc
$fn$;

-- ---------------------------------------------------------------------
--  Harmonogram (pg_cron). Jesli rozszerzenie nie jest dostepne, migracja
--  i tak przechodzi - zadanie mozna wtedy wolac recznie albo z panelu.
-- ---------------------------------------------------------------------
do $blok$
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'pg_cron niedostepny (%). Zadanie retencji trzeba uruchamiac z panelu.', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'retencja-warsztat';
    perform cron.schedule('retencja-warsztat', '17 3 * * *',
                          'select public.zadanie_retencji()');
  end if;
end
$blok$;
