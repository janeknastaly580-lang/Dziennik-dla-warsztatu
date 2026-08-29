-- =====================================================================
--  0003  Logika zapisu z telefonu i obsluga administracyjna
--
--  Kluczowa funkcja: public.zapisz_z_telefonu().
--  Realizuje naraz cztery zabezpieczenia z listy ryzyk:
--
--   B1  UPDATE dotyka WYLACZNIE kolumn faktycznie zmienionych na telefonie
--       (jsonb `p_pola` zawiera tylko te kolumny). Mechanik, ktory zmienil
--       opis, nie cofnie statusu ustawionego przez kolege.
--   B2  'usun' to `usuniete_o = now()`, nigdy fizyczny DELETE.
--   B8  Kazdy blad danych jest LAPANY i odkladany do tabeli kwarantanna,
--       a funkcja konczy sie POPRAWNIE. Backend nie ma jak zwrocic trwalego
--       4xx, wiec kolejka na telefonie nigdy sie nie zatka.
--   B12 Klucz idempotencji: powtorzona wysylka oddaje zapamietany wynik
--       zamiast tworzyc drugi rekord.
-- =====================================================================

-- Domkniecie ostrzezen z Security Advisor dla funkcji z migracji 0001.
alter function public.norm_telefon(text)  set search_path = pg_catalog;
alter function public.norm_tekst(text)    set search_path = pg_catalog;
alter function public.trg_znaczniki()     set search_path = pg_catalog, public;
alter function public.trg_zapisane_o()    set search_path = pg_catalog, public;

-- ---------------------------------------------------------------------
-- B5  Numer oficjalny zlecenia - nadaje go WYLACZNIE serwer.
--     Dwa warsztaty pracujace offline nie moga wygenerowac tego samego
--     numeru, bo zaden telefon numeru nie nadaje.
-- ---------------------------------------------------------------------
create or replace function public.nadaj_numer(p_warsztat uuid)
returns text
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  v_rok integer := extract(year from current_date)::integer;
  v_n   integer;
  v_pre text;
begin
  insert into public.numeratory (warsztat_id, rok, ostatni)
  values (p_warsztat, v_rok, 1)
  on conflict (warsztat_id, rok)
    do update set ostatni = public.numeratory.ostatni + 1
  returning ostatni into v_n;

  select prefiks into v_pre from public.warsztaty where id = p_warsztat;
  return format('%s/%s/%s', coalesce(v_pre, 'W'), v_rok, lpad(v_n::text, 4, '0'));
end
$fn$;

-- ---------------------------------------------------------------------
-- Uwierzytelnienie urzadzenia po hashu tokenu.
--   D1: token nie ma daty waznosci - brak sieci nigdy nie wylogowuje.
--   A6: blokada mechanika lub urzadzenia dziala natychmiast.
-- ---------------------------------------------------------------------
create or replace function public.uwierzytelnij_urzadzenie(
  p_token_hash     text,
  p_wersja_apl     text default null,
  p_wersja_schematu integer default null
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare v jsonb;
begin
  select jsonb_build_object(
           'urzadzenie_id', u.id,
           'mechanik_id',   u.mechanik_id,
           'mechanik_imie', m.imie,
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
end
$fn$;

-- ---------------------------------------------------------------------
-- Kolumny, ktore telefon w ogole moze zapisac (B13 - lista dozwolonych).
-- ---------------------------------------------------------------------
create or replace function public.dozwolone_kolumny(p_tabela text)
returns text[]
language sql immutable
set search_path = pg_catalog
as $fn$
  select case p_tabela
    when 'klienci' then
      array['nazwa','telefon','email','adres','nip','notatki']
    when 'wizyty' then
      array['klient_id','auto','tytul','opis','status','priorytet',
            'data_wizyty','data_zamkniecia','przebieg','koszt','numer_roboczy']
    else array[]::text[]
  end
$fn$;

-- ---------------------------------------------------------------------
-- B8  Odlozenie odrzuconego zapisu do kwarantanny.
-- ---------------------------------------------------------------------
create or replace function public.do_kwarantanny(
  p_warsztat uuid, p_urzadzenie uuid, p_mechanik uuid,
  p_tabela text, p_rekord uuid, p_operacja text,
  p_ladunek jsonb, p_blad text
) returns void
language sql
set search_path = pg_catalog, public
as $fn$
  insert into public.kwarantanna
    (warsztat_id, urzadzenie_id, mechanik_id, tabela, rekord_id, operacja, ladunek, blad)
  values
    (p_warsztat, p_urzadzenie, p_mechanik, p_tabela, p_rekord, p_operacja,
     coalesce(p_ladunek, '{}'::jsonb), left(coalesce(p_blad, 'nieznany blad'), 2000))
$fn$;

-- ---------------------------------------------------------------------
--  GLOWNA FUNKCJA ZAPISU Z TELEFONU
-- ---------------------------------------------------------------------
create or replace function public.zapisz_z_telefonu(
  p_urzadzenie  uuid,
  p_mechanik    uuid,
  p_warsztat    uuid,
  p_klucz       text,
  p_tabela      text,
  p_rekord      uuid,
  p_operacja    text,
  p_pola        jsonb,
  p_zrobione_o  timestamptz
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  v_wynik      jsonb;
  v_dozwolone  text[];
  v_kolumny    text[];
  v_set        text;
  v_kol        text;
  v_war        text;
  v_sql        text;
  v_relid      oid;
  v_istnieje   boolean;
  v_dubel      uuid;
  v_numer      text;
  v_docelowy   uuid;
  v_zrobione   timestamptz;
begin
  -- --- B12: czy dokladnie ten zapis juz przeszedl? ------------------
  select wynik into v_wynik from public.operacje where klucz = p_klucz;
  if v_wynik is not null then
    return v_wynik || jsonb_build_object('powtorka', true);
  end if;

  begin
    -- --- walidacja wejscia (B13) -----------------------------------
    if p_tabela not in ('klienci', 'wizyty', 'dziennik_dostepu') then
      raise exception 'Nieznana tabela: %', p_tabela;
    end if;
    if p_operacja not in ('wstaw', 'zmien', 'usun', 'scal') then
      raise exception 'Nieznana operacja: %', p_operacja;
    end if;
    if p_rekord is null then
      raise exception 'Brak identyfikatora rekordu';
    end if;
    if p_warsztat is null then
      raise exception 'Urzadzenie nie jest przypisane do warsztatu';
    end if;

    -- B6: zegar telefonu nigdy nie wyprzedza zegara serwera
    v_zrobione := least(coalesce(p_zrobione_o, now()), now());

    -- ================= DZIENNIK DOSTEPU (A10) ======================
    if p_tabela = 'dziennik_dostepu' then
      if p_operacja <> 'wstaw' then
        raise exception 'Dziennik dostepu przyjmuje wylacznie wpisy';
      end if;
      insert into public.dziennik_dostepu
        (warsztat_id, mechanik_id, urzadzenie_id, akcja, klient_id, wizyta_id, kiedy)
      values
        (p_warsztat, p_mechanik, p_urzadzenie,
         left(coalesce(p_pola->>'akcja', 'nieznana'), 60),
         nullif(p_pola->>'klient_id', '')::uuid,
         nullif(p_pola->>'wizyta_id', '')::uuid,
         v_zrobione);
      v_wynik := jsonb_build_object('status', 'ok', 'id', p_rekord);

    -- ===================== SCALANIE KARTOTEK (B3) ==================
    elsif p_operacja = 'scal' then
      if p_tabela <> 'klienci' then
        raise exception 'Scalac mozna wylacznie kartoteki klientow';
      end if;
      v_docelowy := nullif(p_pola->>'docelowy', '')::uuid;
      if v_docelowy is null or v_docelowy = p_rekord then
        raise exception 'Bledny cel scalenia';
      end if;
      perform 1 from public.klienci
        where id = v_docelowy and warsztat_id = p_warsztat and usuniete_o is null;
      if not found then
        raise exception 'Kartoteka docelowa nie istnieje';
      end if;

      update public.wizyty
         set klient_id = v_docelowy, zmienione_przez = p_mechanik
       where klient_id = p_rekord and warsztat_id = p_warsztat;

      update public.klienci
         set scalony_z = v_docelowy,
             usuniete_o = coalesce(usuniete_o, now()),
             zmienione_przez = p_mechanik
       where id = p_rekord and warsztat_id = p_warsztat;

      update public.mozliwe_duplikaty
         set rozwiazane_o = now()
       where warsztat_id = p_warsztat
         and (rekord_id = p_rekord or podobny_do = p_rekord);

      v_wynik := jsonb_build_object('status', 'scalone', 'id', p_rekord, 'docelowy', v_docelowy);

    -- ========================= SOFT DELETE (B2) ====================
    elsif p_operacja = 'usun' then
      v_sql := format(
        'update public.%I set usuniete_o = coalesce(usuniete_o, now()),
                              zmienione_przez = $2
          where id = $1 and warsztat_id = $3', p_tabela);
      execute v_sql using p_rekord, p_mechanik, p_warsztat;
      -- B9: brak wiersza nie jest bledem - moze jeszcze nie dojechal
      v_wynik := jsonb_build_object('status', 'ok', 'id', p_rekord);

    -- ============================ ZAPIS ============================
    else
      v_dozwolone := public.dozwolone_kolumny(p_tabela);
      select array_agg(k order by k) into v_kolumny
        from jsonb_object_keys(coalesce(p_pola, '{}'::jsonb)) as k
       where k = any (v_dozwolone);

      if v_kolumny is null or array_length(v_kolumny, 1) = 0 then
        raise exception 'Brak dozwolonych kolumn do zapisu w tabeli %', p_tabela;
      end if;

      v_relid := format('public.%I', p_tabela)::regclass::oid;

      execute format('select exists (select 1 from public.%I where id = $1)', p_tabela)
        into v_istnieje using p_rekord;

      ------------------------------------------------------------------
      -- B1: UPDATE tylko na kolumnach, ktore telefon faktycznie zmienil
      ------------------------------------------------------------------
      if p_operacja = 'zmien' or v_istnieje then
        if not v_istnieje then
          raise exception 'Rekord % nie istnieje', p_rekord;
        end if;

        select string_agg(
                 format('%I = ($1->>%L)::%s', a.attname, a.attname,
                        format_type(a.atttypid, a.atttypmod)), ', ')
          into v_set
          from unnest(v_kolumny) as k(nazwa)
          join pg_attribute a
            on a.attrelid = v_relid and a.attname = k.nazwa
           and a.attnum > 0 and not a.attisdropped;

        v_sql := format(
          'update public.%I set %s, zmienione_przez = $2, zrobione_o = $4
            where id = $3 and warsztat_id = $5', p_tabela, v_set);
        execute v_sql using p_pola, p_mechanik, p_rekord, v_zrobione, p_warsztat;

        v_wynik := jsonb_build_object('status', 'ok', 'id', p_rekord, 'zmieniono', v_kolumny);

      ------------------------------------------------------------------
      -- INSERT (idempotentny po kluczu glownym - B12)
      ------------------------------------------------------------------
      else
        select string_agg(format('%I', a.attname), ', '),
               string_agg(format('($1->>%L)::%s', a.attname,
                                 format_type(a.atttypid, a.atttypmod)), ', ')
          into v_kol, v_war
          from unnest(v_kolumny) as k(nazwa)
          join pg_attribute a
            on a.attrelid = v_relid and a.attname = k.nazwa
           and a.attnum > 0 and not a.attisdropped;

        v_sql := format(
          'insert into public.%I (id, warsztat_id, zrobione_o, utworzone_przez,
                                  zmienione_przez, %s)
           values ($2, $3, $4, $5, $5, %s)
           on conflict (id) do nothing', p_tabela, v_kol, v_war);
        execute v_sql using p_pola, p_rekord, p_warsztat, v_zrobione, p_mechanik;

        v_wynik := jsonb_build_object('status', 'ok', 'id', p_rekord);

        ----------------------------------------------------------------
        -- B5: numer oficjalny nadawany przez serwer
        ----------------------------------------------------------------
        if p_tabela = 'wizyty' then
          update public.wizyty
             set numer_oficjalny = public.nadaj_numer(p_warsztat)
           where id = p_rekord and numer_oficjalny is null
          returning numer_oficjalny into v_numer;
          if v_numer is not null then
            v_wynik := v_wynik || jsonb_build_object('numer_oficjalny', v_numer);
          end if;
        end if;

        ----------------------------------------------------------------
        -- B3: wykrywanie duplikatow zalozonych niezaleznie w trybie offline
        ----------------------------------------------------------------
        if p_tabela = 'klienci' then
          select id into v_dubel
            from public.klienci
           where warsztat_id = p_warsztat and usuniete_o is null and id <> p_rekord
             and telefon_norm is not null
             and telefon_norm = public.norm_telefon(p_pola->>'telefon')
           order by utworzono
           limit 1;
        elsif p_tabela = 'wizyty' then
          select id into v_dubel
            from public.wizyty
           where warsztat_id = p_warsztat and usuniete_o is null and id <> p_rekord
             and status <> 'naprawione'
             and auto_norm is not null
             and auto_norm = public.norm_tekst(p_pola->>'auto')
             and zrobione_o > v_zrobione - interval '48 hours'
           order by zrobione_o desc
           limit 1;
        end if;

        if v_dubel is not null then
          insert into public.mozliwe_duplikaty
            (warsztat_id, tabela, rekord_id, podobny_do, powod)
          values
            (p_warsztat, p_tabela, p_rekord, v_dubel,
             case p_tabela when 'klienci' then 'ten sam numer telefonu'
                           else 'to samo auto z otwarta wizyta w ciagu 48 h' end)
          on conflict do nothing;
          v_wynik := v_wynik || jsonb_build_object('mozliwy_duplikat', v_dubel);
        end if;
      end if;
    end if;

  exception when others then
    ----------------------------------------------------------------------
    -- B8: NIGDY nie oddajemy trwalego bledu. Zapis ladzie w kwarantannie,
    --     telefon dostaje potwierdzenie przyjecia i idzie dalej.
    ----------------------------------------------------------------------
    perform public.do_kwarantanny(p_warsztat, p_urzadzenie, p_mechanik,
                                  p_tabela, p_rekord, p_operacja, p_pola, sqlerrm);
    v_wynik := jsonb_build_object('status', 'kwarantanna', 'id', p_rekord,
                                  'blad', left(sqlerrm, 300));
  end;

  -- B12: zapamietanie wyniku dla ewentualnego ponowienia
  insert into public.operacje (klucz, urzadzenie_id, wynik)
  values (p_klucz, p_urzadzenie, v_wynik)
  on conflict (klucz) do nothing;

  return v_wynik;
end
$fn$;

-- ---------------------------------------------------------------------
--  A3  Odczyt w waskim oknie synchronizacji.
--      Sync rules to OSOBNA warstwa bezpieczenstwa - nie wynikaja z RLS.
--      Telefon dostaje: kartoteki swojego warsztatu + wizyty z ostatnich
--      `okno_dni` dni ORAZ wszystkie wizyty nadal otwarte.
-- ---------------------------------------------------------------------
create or replace function public.pobierz_wizyty(
  p_warsztat uuid, p_okno_dni integer,
  p_kursor_ts timestamptz, p_kursor_id uuid, p_limit integer
)
returns setof public.wizyty
language sql stable
set search_path = pg_catalog, public
as $fn$
  select *
    from public.wizyty w
   where w.warsztat_id = p_warsztat
     and (w.data_wizyty >= current_date - p_okno_dni or w.status <> 'naprawione')
     and (p_kursor_ts is null
          or (w.zapisane_o, w.id) > (p_kursor_ts, coalesce(p_kursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
   order by w.zapisane_o, w.id
   limit greatest(1, least(coalesce(p_limit, 500), 2000))
$fn$;

create or replace function public.pobierz_klientow(
  p_warsztat uuid,
  p_kursor_ts timestamptz, p_kursor_id uuid, p_limit integer
)
returns setof public.klienci
language sql stable
set search_path = pg_catalog, public
as $fn$
  select *
    from public.klienci k
   where k.warsztat_id = p_warsztat
     and (p_kursor_ts is null
          or (k.zapisane_o, k.id) > (p_kursor_ts, coalesce(p_kursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
   order by k.zapisane_o, k.id
   limit greatest(1, least(coalesce(p_limit, 500), 2000))
$fn$;

-- ---------------------------------------------------------------------
--  Panel administratora: przyznanie i odebranie dostepu
-- ---------------------------------------------------------------------

-- Przyznanie dostepu urzadzeniu, ktore czeka z kodem parowania.
-- To jest wlasnie "dostep zdalny, jednorazowo, bez podawania hasla":
-- administrator klika w panelu, telefon przy najblizszym odpytaniu
-- odbiera token i prosi mechanika o ustawienie wlasnego hasla.
create or replace function public.przyznaj_dostep(
  p_kod text, p_mechanik uuid, p_kto text
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare v_id uuid; v_warsztat uuid;
begin
  select warsztat_id into v_warsztat from public.mechanicy
   where id = p_mechanik and usuniete_o is null;
  if v_warsztat is null then
    return jsonb_build_object('ok', false, 'blad', 'Nie znaleziono mechanika');
  end if;

  update public.urzadzenia
     set mechanik_id = p_mechanik,
         warsztat_id = v_warsztat,
         przyznany_o = now(),
         przyznany_przez = left(coalesce(p_kto, 'administrator'), 120),
         zablokowane_o = null,
         powod_blokady = null,
         zadanie_wyczyszczenia_o = null,
         zadanie_resetu_hasla_o = now()   -- mechanik ustawi wlasne haslo
   where upper(btrim(p_kod)) = kod_parowania
     and przyznany_o is null
     and usuniete_o is null
     and kod_wygasa_o > now()
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'blad', 'Kod nieznany, juz uzyty albo wygasl');
  end if;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'przyznanie_dostepu',
          jsonb_build_object('urzadzenie', v_id, 'mechanik', p_mechanik));

  return jsonb_build_object('ok', true, 'urzadzenie', v_id);
end
$fn$;

-- A6: odebranie dostepu. `p_wyczysc` dokłada zdalne skasowanie lokalnej
-- bazy przy najblizszym kontakcie telefonu z serwerem.
create or replace function public.zablokuj_urzadzenie(
  p_urzadzenie uuid, p_powod text, p_kto text, p_wyczysc boolean default true
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  update public.urzadzenia
     set zablokowane_o = now(),
         powod_blokady = left(coalesce(p_powod, 'brak podanego powodu'), 500),
         token_hash = null,               -- uniewaznienie sesji
         zadanie_wyczyszczenia_o = case when p_wyczysc then now() else null end
   where id = p_urzadzenie;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'blokada_urzadzenia',
          jsonb_build_object('urzadzenie', p_urzadzenie, 'wyczysc', p_wyczysc));

  return jsonb_build_object('ok', true);
end
$fn$;

-- A6: blokada calego konta mechanika - odcina wszystkie jego urzadzenia.
create or replace function public.zablokuj_mechanika(
  p_mechanik uuid, p_powod text, p_kto text, p_wyczysc boolean default true
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  update public.mechanicy
     set zablokowany_o = now(),
         powod_blokady = left(coalesce(p_powod, 'brak podanego powodu'), 500)
   where id = p_mechanik;

  update public.urzadzenia
     set zablokowane_o = now(),
         powod_blokady = left(coalesce(p_powod, 'konto zablokowane'), 500),
         token_hash = null,
         zadanie_wyczyszczenia_o = case when p_wyczysc then now() else null end
   where mechanik_id = p_mechanik;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'blokada_mechanika',
          jsonb_build_object('mechanik', p_mechanik, 'wyczysc', p_wyczysc));

  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function public.odblokuj_mechanika(p_mechanik uuid, p_kto text)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  update public.mechanicy
     set zablokowany_o = null, powod_blokady = null
   where id = p_mechanik;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'odblokowanie_mechanika',
          jsonb_build_object('mechanik', p_mechanik));

  return jsonb_build_object('ok', true);
end
$fn$;

-- Administrator kaze ustawic nowe haslo na konkretnym telefonie.
create or replace function public.wymus_nowe_haslo(p_urzadzenie uuid, p_kto text)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  update public.urzadzenia set zadanie_resetu_hasla_o = now() where id = p_urzadzenie;
  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'reset_hasla',
          jsonb_build_object('urzadzenie', p_urzadzenie));
  return jsonb_build_object('ok', true);
end
$fn$;

-- ---------------------------------------------------------------------
--  Monitoring dla panelu administratora
--   B8: telefon, ktory od ponad doby nie dosylal danych
--   B7/B8: nierozwiazane wpisy w kwarantannie
-- ---------------------------------------------------------------------
create or replace function public.stan_systemu()
returns jsonb
language sql stable
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object(
    'warsztaty',   (select count(*) from public.warsztaty where usuniete_o is null),
    'mechanicy',   (select count(*) from public.mechanicy where usuniete_o is null),
    'zablokowani', (select count(*) from public.mechanicy where zablokowany_o is not null),
    'urzadzenia',  (select count(*) from public.urzadzenia
                     where usuniete_o is null and token_hash is not null),
    'oczekujace_kody', (select count(*) from public.urzadzenia
                         where przyznany_o is null and kod_wygasa_o > now()),
    'klienci',     (select count(*) from public.klienci where usuniete_o is null),
    'wizyty',      (select count(*) from public.wizyty where usuniete_o is null),
    'otwarte',     (select count(*) from public.wizyty
                     where usuniete_o is null and status <> 'naprawione'),
    'kwarantanna', (select count(*) from public.kwarantanna where rozwiazane_o is null),
    'duplikaty',   (select count(*) from public.mozliwe_duplikaty where rozwiazane_o is null),
    'milczace_urzadzenia', (select count(*) from public.urzadzenia
                             where token_hash is not null and usuniete_o is null
                               and coalesce(ostatnia_sync_o, token_wydany_o)
                                   < now() - interval '24 hours')
  )
$fn$;
