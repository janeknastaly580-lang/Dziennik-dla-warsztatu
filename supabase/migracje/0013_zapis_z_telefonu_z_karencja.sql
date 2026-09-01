-- =====================================================================
--  0013  Zapis z telefonu respektuje karencje usuwania (0012).
--
--  Jedyna roznica wobec wersji z migracji 0003 to blok w galezi 'usun':
--  przed skasowaniem wizyty pytamy `mozna_usunac_wizyte()`.
--
--  Odmowa NIE jest bledem danych, wiec nie ladzie w kwarantannie - telefon
--  dostaje jawny status 'odmowa' z powodem, przywraca u siebie wizyte
--  i pokazuje mechanikowi komunikat. Kwarantanna zostaje dla rzeczy,
--  ktorych czlowiek nie przewidzial; tu wynik jest zamierzony.
-- =====================================================================

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
  v_ocena      jsonb;
begin
  select wynik into v_wynik from public.operacje where klucz = p_klucz;
  if v_wynik is not null then
    return v_wynik || jsonb_build_object('powtorka', true);
  end if;

  begin
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

    v_zrobione := least(coalesce(p_zrobione_o, now()), now());

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

    elsif p_operacja = 'usun' then
      -- 0012: karencja na usuwanie wizyt. Odmowa jest zamierzonym wynikiem,
      -- a nie bledem - telefon ma ja pokazac, a nie ponawiac ani ukrywac.
      if p_tabela = 'wizyty' then
        v_ocena := public.mozna_usunac_wizyte(p_rekord);
        if not (v_ocena->>'mozna')::boolean then
          v_wynik := jsonb_build_object('status', 'odmowa', 'id', p_rekord,
                                        'powod', v_ocena->>'powod',
                                        'wolno_od', v_ocena->>'wolno_od');
          insert into public.operacje (klucz, urzadzenie_id, wynik)
          values (p_klucz, p_urzadzenie, v_wynik) on conflict (klucz) do nothing;
          return v_wynik;
        end if;
      end if;

      v_sql := format(
        'update public.%I set usuniete_o = coalesce(usuniete_o, now()),
                              zmienione_przez = $2
          where id = $1 and warsztat_id = $3', p_tabela);
      execute v_sql using p_rekord, p_mechanik, p_warsztat;
      v_wynik := jsonb_build_object('status', 'ok', 'id', p_rekord);

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

        if p_tabela = 'wizyty' then
          update public.wizyty
             set numer_oficjalny = public.nadaj_numer(p_warsztat)
           where id = p_rekord and numer_oficjalny is null
          returning numer_oficjalny into v_numer;
          if v_numer is not null then
            v_wynik := v_wynik || jsonb_build_object('numer_oficjalny', v_numer);
          end if;
        end if;

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
    perform public.do_kwarantanny(p_warsztat, p_urzadzenie, p_mechanik,
                                  p_tabela, p_rekord, p_operacja, p_pola, sqlerrm);
    v_wynik := jsonb_build_object('status', 'kwarantanna', 'id', p_rekord,
                                  'blad', left(sqlerrm, 300));
  end;

  insert into public.operacje (klucz, urzadzenie_id, wynik)
  values (p_klucz, p_urzadzenie, v_wynik)
  on conflict (klucz) do nothing;

  return v_wynik;
end
$fn$;

grant execute on all routines in schema public to service_role;
