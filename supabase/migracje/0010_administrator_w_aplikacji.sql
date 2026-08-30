-- =====================================================================
--  0010  Administrator jest mechanikiem z dodatkowymi uprawnieniami,
--        a nie osobnym panelem na czyimkolwiek komputerze.
--
--  Dostawca uslugi nie hostuje niczego. Caly system to:
--    Supabase (baza + funkcje brzegowe)  +  aplikacja na telefonach.
--
--  Administrator moze DOKLADNIE dwie rzeczy wiecej niz mechanik:
--    1. przyznac dostep telefonowi (zdalnie, jednorazowym kodem, bez hasla)
--    2. odebrac dostep mechanikowi albo pojedynczemu telefonowi
--  Plus wymuszenie ustawienia nowego hasla, bo to czesc punktu 1.
--  Nie widzi wiecej danych klientow niz zwykly mechanik.
-- =====================================================================

-- Rola administratora warsztatu
alter table public.mechanicy drop constraint if exists mechanicy_rola_check;
alter table public.mechanicy add constraint mechanicy_rola_check
  check (rola in ('mechanik', 'kierownik', 'administrator'));

-- ---------------------------------------------------------------------
--  ZAPROSZENIA - jedyna droga zalozenia warsztatu i pierwszego admina.
--  Kod wystawia dostawca uslugi; jest jednorazowy i ma date waznosci.
-- ---------------------------------------------------------------------
create table if not exists public.zaproszenia (
  kod                text primary key check (kod ~ '^[A-Z0-9-]{8,24}$'),
  warsztat_id        uuid references public.warsztaty(id),
  nazwa_warsztatu    text check (length(btrim(nazwa_warsztatu)) between 1 and 200),
  prefiks            text check (prefiks ~ '^[A-Z0-9]{1,4}$'),
  imie               text not null check (length(btrim(imie)) between 1 and 120),
  rola               text not null default 'administrator'
                       check (rola in ('administrator', 'kierownik', 'mechanik')),
  wygasa_o           timestamptz not null,
  wykorzystane_o     timestamptz,
  wykorzystane_przez uuid references public.urzadzenia(id),
  utworzono          timestamptz not null default now()
);

alter table public.zaproszenia enable row level security;
revoke all on public.zaproszenia from anon, authenticated;
grant all on public.zaproszenia to service_role;

create index if not exists idx_zaproszenia_wazne
  on public.zaproszenia (wygasa_o) where wykorzystane_o is null;

-- ---------------------------------------------------------------------
--  Pomocnicze
-- ---------------------------------------------------------------------

-- Prefiks numeru zlecenia musi byc unikalny - B5.
create or replace function public.wolny_prefiks(p_propozycja text)
returns text language plpgsql set search_path = pg_catalog, public as $fn$
declare v text; i integer := 1;
begin
  v := upper(coalesce(nullif(btrim(p_propozycja), ''), 'W'));
  v := regexp_replace(v, '[^A-Z0-9]', '', 'g');
  v := left(nullif(v, ''), 4);
  if v is null then v := 'W'; end if;

  while exists (select 1 from public.warsztaty where prefiks = v) loop
    i := i + 1;
    v := left(regexp_replace(upper(coalesce(nullif(btrim(p_propozycja),''),'W')), '[^A-Z0-9]', '', 'g'), 3)
         || i::text;
    if i > 999 then
      v := 'W' || substr(md5(random()::text), 1, 3);
      v := upper(regexp_replace(v, '[^A-Z0-9]', '', 'g'));
      exit;
    end if;
  end loop;
  return v;
end $fn$;

-- Wystawienie zaproszenia. Wolane przez dostawce uslugi (SQL Editor albo
-- narzedzia/zaproszenie.js) - nigdy przez aplikacje.
create or replace function public.utworz_zaproszenie(
  p_nazwa_warsztatu text,
  p_imie            text,
  p_prefiks         text default null,
  p_dni_waznosci    integer default 14,
  p_warsztat_id     uuid default null,
  p_rola            text default 'administrator'
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare
  v_alfabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_kod text;
  i integer;
begin
  for proba in 1..10 loop
    v_kod := '';
    for i in 1..12 loop
      v_kod := v_kod || substr(v_alfabet, 1 + floor(random() * length(v_alfabet))::int, 1);
      if i in (4, 8) then v_kod := v_kod || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.zaproszenia where kod = v_kod);
  end loop;

  insert into public.zaproszenia
    (kod, warsztat_id, nazwa_warsztatu, prefiks, imie, rola, wygasa_o)
  values
    (v_kod, p_warsztat_id, p_nazwa_warsztatu,
     upper(nullif(btrim(coalesce(p_prefiks, '')), '')),
     p_imie, p_rola,
     now() + make_interval(days => greatest(1, least(coalesce(p_dni_waznosci, 14), 90))));

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values ('dostawca', 'wystawienie_zaproszenia',
          jsonb_build_object('kod', v_kod, 'warsztat', p_nazwa_warsztatu, 'rola', p_rola));

  return jsonb_build_object('ok', true, 'kod', v_kod,
                            'wygasa_o', now() + make_interval(days => coalesce(p_dni_waznosci, 14)));
end $fn$;

-- Aktywacja zaproszenia przez telefon: zaklada warsztat (jesli trzeba),
-- zaklada konto i przypisuje do niego to urzadzenie.
create or replace function public.aktywuj_zaproszenie(p_urzadzenie uuid, p_kod text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare
  z public.zaproszenia%rowtype;
  v_warsztat uuid;
  v_mechanik uuid;
begin
  select * into z from public.zaproszenia
   where kod = upper(btrim(p_kod)) for update;

  if not found then
    return jsonb_build_object('ok', false, 'blad', 'Nieznany kod zaproszenia');
  end if;
  if z.wykorzystane_o is not null then
    return jsonb_build_object('ok', false, 'blad', 'Ten kod zostal juz wykorzystany');
  end if;
  if z.wygasa_o < now() then
    return jsonb_build_object('ok', false, 'blad', 'Kod zaproszenia stracil waznosc');
  end if;

  v_warsztat := z.warsztat_id;
  if v_warsztat is null then
    insert into public.warsztaty (nazwa, prefiks)
    values (coalesce(z.nazwa_warsztatu, 'Warsztat'), public.wolny_prefiks(z.prefiks))
    returning id into v_warsztat;
  end if;

  insert into public.mechanicy (warsztat_id, imie, rola)
  values (v_warsztat, z.imie, z.rola)
  returning id into v_mechanik;

  update public.urzadzenia
     set mechanik_id = v_mechanik,
         warsztat_id = v_warsztat,
         przyznany_o = now(),
         przyznany_przez = 'kod zaproszenia',
         zablokowane_o = null,
         powod_blokady = null,
         zadanie_wyczyszczenia_o = null,
         zadanie_resetu_hasla_o = now()
   where id = p_urzadzenie and przyznany_o is null and usuniete_o is null;

  if not found then
    return jsonb_build_object('ok', false, 'blad', 'To urzadzenie ma juz przyznany dostep');
  end if;

  update public.zaproszenia
     set wykorzystane_o = now(), wykorzystane_przez = p_urzadzenie
   where kod = z.kod;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (z.imie, 'aktywacja_zaproszenia',
          jsonb_build_object('warsztat', v_warsztat, 'mechanik', v_mechanik, 'rola', z.rola));

  return jsonb_build_object('ok', true, 'warsztat', v_warsztat, 'mechanik', v_mechanik);
end $fn$;

-- ---------------------------------------------------------------------
--  Rola musi dojechac do aplikacji - to na jej podstawie telefon pokazuje
--  albo ukrywa ekran zarzadzania dostepem.
-- ---------------------------------------------------------------------
create or replace function public.uwierzytelnij_urzadzenie(
  p_token_hash      text,
  p_wersja_apl      text default null,
  p_wersja_schematu integer default null
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v jsonb;
begin
  select jsonb_build_object(
           'urzadzenie_id', u.id,
           'mechanik_id',   u.mechanik_id,
           'mechanik_imie', m.imie,
           'rola',          coalesce(m.rola, 'mechanik'),
           'warsztat_id',   w.id,
           'warsztat_nazwa', w.nazwa,
           'prefiks',       w.prefiks,
           'okno_dni',      w.okno_dni,
           'wygasniecie_offline_dni', w.wygasniecie_offline_dni,
           'zablokowane',   (u.zablokowane_o is not null
                             or u.usuniete_o is not null
                             or m.zablokowany_o is not null
                             or m.usuniete_o is not null
                             or w.usuniete_o is not null),
           'powod_blokady', coalesce(u.powod_blokady, m.powod_blokady),
           'wyczysc',       (u.zadanie_wyczyszczenia_o is not null),
           'reset_hasla',   (u.zadanie_resetu_hasla_o is not null)
         )
    into v
    from public.urzadzenia u
    left join public.mechanicy m on m.id = u.mechanik_id
    left join public.warsztaty w on w.id = u.warsztat_id
   where u.token_hash = p_token_hash;

  if v is null then
    return jsonb_build_object('znalezione', false);
  end if;

  update public.urzadzenia
     set ostatni_kontakt_o = now(),
         wersja_aplikacji  = coalesce(p_wersja_apl, wersja_aplikacji),
         wersja_schematu   = coalesce(p_wersja_schematu, wersja_schematu)
   where token_hash = p_token_hash;

  return v || jsonb_build_object('znalezione', true);
end $fn$;

grant execute on all routines in schema public to service_role;
