-- =====================================================================
--  0011  Uprawnienia administratora - dokladnie tyle, ile trzeba
--
--  Kazda funkcja przyjmuje `p_wykonawca` (mechanik, ktorego telefon wysyla
--  zadanie) i sama sprawdza, czy ma prawo to zrobic. Nawet gdyby funkcja
--  brzegowa zawiodla, baza nie pozwoli mechanikowi udawac administratora
--  ani ruszyc kogos z innego warsztatu.
--
--  Zabezpieczenie przed zamknieciem sie na zewnatrz: nie da sie zablokowac
--  samego siebie ani ostatniego czynnego administratora warsztatu.
-- =====================================================================

create or replace function public.sprawdz_admina(p_wykonawca uuid)
returns uuid language plpgsql stable set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid;
begin
  select warsztat_id into v_warsztat
    from public.mechanicy
   where id = p_wykonawca
     and rola = 'administrator'
     and zablokowany_o is null
     and usuniete_o is null;
  if v_warsztat is null then
    raise exception 'Brak uprawnien administratora';
  end if;
  return v_warsztat;
end $fn$;

-- Czy po zablokowaniu tej osoby zostanie ktos, kto moze przyznawac dostep?
create or replace function public.zostanie_admin(p_warsztat uuid, p_bez uuid)
returns boolean language sql stable set search_path = pg_catalog, public as $fn$
  select exists (
    select 1 from public.mechanicy
     where warsztat_id = p_warsztat and rola = 'administrator'
       and zablokowany_o is null and usuniete_o is null and id <> p_bez
  )
$fn$;

-- ---------------------------------------------------------------------
--  Ekran "Dostep" w aplikacji - wszystko, co widzi administrator.
--  Zero danych klientow: same konta, telefony i kody parowania.
-- ---------------------------------------------------------------------
create or replace function public.dane_administracyjne(p_wykonawca uuid)
returns jsonb language plpgsql stable set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);

  return jsonb_build_object(
    'warsztat', (select jsonb_build_object('id', id, 'nazwa', nazwa, 'prefiks', prefiks)
                   from public.warsztaty where id = v_warsztat),
    'mechanicy', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'imie', m.imie, 'rola', m.rola,
               'zablokowany_o', m.zablokowany_o, 'powod_blokady', m.powod_blokady,
               'to_ja', (m.id = p_wykonawca),
               'urzadzenia', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', u.id,
                          'nazwa', u.nazwa_urzadzenia,
                          'platforma', u.platforma,
                          'wersja', u.wersja_aplikacji,
                          'ostatnia_sync_o', u.ostatnia_sync_o,
                          'zablokowane_o', u.zablokowane_o,
                          'czeka_na_haslo', (u.zadanie_resetu_hasla_o is not null))
                        order by u.utworzono desc)
                   from public.urzadzenia u
                  where u.mechanik_id = m.id and u.usuniete_o is null
                    and u.token_hash is not null), '[]'::jsonb))
             order by m.imie)
        from public.mechanicy m
       where m.warsztat_id = v_warsztat and m.usuniete_o is null), '[]'::jsonb),
    'oczekujace', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kod', u.kod_parowania,
               'nazwa', u.nazwa_urzadzenia,
               'platforma', u.platforma,
               'wersja', u.wersja_aplikacji,
               'zgloszone_o', u.utworzono,
               'wygasa_o', u.kod_wygasa_o)
             order by u.utworzono desc)
        from public.urzadzenia u
       where u.przyznany_o is null and u.usuniete_o is null
         and u.kod_parowania is not null and u.kod_wygasa_o > now()), '[]'::jsonb)
  );
end $fn$;

-- ---------------------------------------------------------------------
--  Zalozenie konta mechanikowi
-- ---------------------------------------------------------------------
create or replace function public.admin_dodaj_mechanika(
  p_wykonawca uuid, p_imie text, p_rola text default 'mechanik'
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid; v_id uuid; v_rola text;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);
  v_rola := case when p_rola in ('mechanik','kierownik','administrator')
                 then p_rola else 'mechanik' end;

  if length(btrim(coalesce(p_imie, ''))) = 0 then
    return jsonb_build_object('ok', false, 'blad', 'Podaj imie i nazwisko');
  end if;

  insert into public.mechanicy (warsztat_id, imie, rola)
  values (v_warsztat, btrim(p_imie), v_rola)
  returning id into v_id;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (p_wykonawca::text, 'dodanie_mechanika',
          jsonb_build_object('mechanik', v_id, 'rola', v_rola));

  return jsonb_build_object('ok', true, 'mechanik', v_id);
end $fn$;

-- ---------------------------------------------------------------------
--  1. PRZYZNANIE DOSTEPU - zdalnie, jednorazowym kodem, bez hasla
-- ---------------------------------------------------------------------
create or replace function public.admin_przyznaj_dostep(
  p_wykonawca uuid, p_kod text, p_mechanik uuid
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid; v_id uuid;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);

  perform 1 from public.mechanicy
   where id = p_mechanik and warsztat_id = v_warsztat and usuniete_o is null;
  if not found then
    return jsonb_build_object('ok', false, 'blad', 'Ten mechanik nie nalezy do Twojego warsztatu');
  end if;

  update public.urzadzenia
     set mechanik_id = p_mechanik,
         warsztat_id = v_warsztat,
         przyznany_o = now(),
         przyznany_przez = p_wykonawca::text,
         zablokowane_o = null,
         powod_blokady = null,
         zadanie_wyczyszczenia_o = null,
         zadanie_resetu_hasla_o = now()      -- mechanik ustawi wlasne haslo
   where kod_parowania = upper(btrim(p_kod))
     and przyznany_o is null
     and usuniete_o is null
     and kod_wygasa_o > now()
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'blad', 'Kod nieznany, juz uzyty albo wygasl');
  end if;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (p_wykonawca::text, 'przyznanie_dostepu',
          jsonb_build_object('urzadzenie', v_id, 'mechanik', p_mechanik));

  return jsonb_build_object('ok', true, 'urzadzenie', v_id);
end $fn$;

-- ---------------------------------------------------------------------
--  2. ODEBRANIE DOSTEPU
-- ---------------------------------------------------------------------
create or replace function public.admin_zablokuj_mechanika(
  p_wykonawca uuid, p_mechanik uuid, p_powod text default null
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);

  if p_mechanik = p_wykonawca then
    return jsonb_build_object('ok', false, 'blad', 'Nie mozesz zablokowac samego siebie');
  end if;

  perform 1 from public.mechanicy
   where id = p_mechanik and warsztat_id = v_warsztat and usuniete_o is null;
  if not found then
    return jsonb_build_object('ok', false, 'blad', 'Ten mechanik nie nalezy do Twojego warsztatu');
  end if;

  if not public.zostanie_admin(v_warsztat, p_mechanik) then
    return jsonb_build_object('ok', false,
      'blad', 'To ostatni czynny administrator - warsztat zostalby bez nikogo, kto przyznaje dostep');
  end if;

  return public.zablokuj_mechanika(
    p_mechanik, coalesce(p_powod, 'dostep odebrany przez administratora'),
    p_wykonawca::text, true);
end $fn$;

create or replace function public.admin_odblokuj_mechanika(p_wykonawca uuid, p_mechanik uuid)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);
  perform 1 from public.mechanicy
   where id = p_mechanik and warsztat_id = v_warsztat and usuniete_o is null;
  if not found then
    return jsonb_build_object('ok', false, 'blad', 'Ten mechanik nie nalezy do Twojego warsztatu');
  end if;
  return public.odblokuj_mechanika(p_mechanik, p_wykonawca::text);
end $fn$;

create or replace function public.admin_urzadzenie(
  p_wykonawca uuid, p_urzadzenie uuid, p_akcja text, p_powod text default null
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid; v_mechanik uuid;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);

  select mechanik_id into v_mechanik from public.urzadzenia
   where id = p_urzadzenie and warsztat_id = v_warsztat;
  if v_mechanik is null then
    return jsonb_build_object('ok', false, 'blad', 'To urzadzenie nie nalezy do Twojego warsztatu');
  end if;

  -- Blokada wlasnego telefonu odcielaby administratora od panelu.
  if v_mechanik = p_wykonawca and p_akcja in ('zablokuj', 'wyrejestruj') then
    return jsonb_build_object('ok', false, 'blad', 'Nie mozesz odciac wlasnego telefonu');
  end if;

  if p_akcja = 'zablokuj' then
    return public.zablokuj_urzadzenie(p_urzadzenie,
             coalesce(p_powod, 'telefon zablokowany przez administratora'),
             p_wykonawca::text, true);
  elsif p_akcja = 'odblokuj' then
    return public.odblokuj_urzadzenie(p_urzadzenie, p_wykonawca::text);
  elsif p_akcja = 'wyrejestruj' then
    return public.wyrejestruj_urzadzenie(p_urzadzenie, p_wykonawca::text);
  elsif p_akcja = 'reset_hasla' then
    return public.wymus_nowe_haslo(p_urzadzenie, p_wykonawca::text);
  end if;

  return jsonb_build_object('ok', false, 'blad', 'Nieznana akcja');
end $fn$;

grant execute on all routines in schema public to service_role;
