-- =====================================================================
--  0012  Zatwierdzanie dostepu jednym klikiem  +  jeden administrator
--
--  CO SIE ZMIENIA W PRZEBIEGU
--
--  Bylo:  mechanik odczytuje kod z ekranu -> dyktuje go administratorowi ->
--         administrator przepisuje kod, wybiera z listy konto mechanika
--         (ktore wczesniej musial recznie zalozyc) -> "Przyznaj dostep".
--         Trzy miejsca, w ktorych mozna sie pomylic, i jedno konto zakladane
--         "na zapas" przez osobe, ktora nie zna pisowni nazwiska.
--
--  Jest:  mechanik wpisuje na swoim telefonie WLASNE imie i nazwisko i prosi
--         o dostep. Administratorowi pojawia sie na liscie gotowy wiersz:
--         imie, nazwisko, kod z ekranu tego telefonu. Klika "Zatwierdz".
--         Konto zaklada sie samo, z imienia podanego przez zainteresowanego.
--         Administrator nie wpisuje ani jednego znaku.
--
--  JEDEN ADMINISTRATOR NA WARSZTAT
--  Zatwierdzone telefony dostaja zawsze role "mechanik". Administratorem
--  zostaje wylacznie osoba, ktora zalozyla warsztat kodem zaproszenia.
--  Pilnuje tego indeks unikalny, a nie tylko warunek w funkcji - inaczej
--  dwa zadania wyslane w tej samej sekundzie moglyby go obejsc.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Imie i nazwisko deklarowane przez samego mechanika przy zgloszeniu
-- ---------------------------------------------------------------------
alter table public.urzadzenia
  add column if not exists imie_zgloszone text;

alter table public.urzadzenia drop constraint if exists urzadzenia_imie_zgloszone_check;
alter table public.urzadzenia add constraint urzadzenia_imie_zgloszone_check
  check (imie_zgloszone is null or length(btrim(imie_zgloszone)) between 1 and 120);

-- ---------------------------------------------------------------------
--  2. Najwyzej jeden administrator w warsztacie
--
--  Zablokowany administrator NADAL zajmuje to miejsce - inaczej blokada
--  byla by furtka do zrobienia drugiego admina. Zwolnic je moze tylko
--  skasowanie konta (usuniete_o).
-- ---------------------------------------------------------------------
-- Gdyby w istniejacych danych bylo kilku administratorow, zostaw najstarszego,
-- reszcie zamien role na "kierownik" - inaczej indeks nie powstanie.
update public.mechanicy m
   set rola = 'kierownik'
 where m.rola = 'administrator'
   and m.usuniete_o is null
   and m.id <> (
     select m2.id from public.mechanicy m2
      where m2.warsztat_id = m.warsztat_id
        and m2.rola = 'administrator'
        and m2.usuniete_o is null
      order by m2.utworzono, m2.id
      limit 1);

create unique index if not exists idx_jeden_administrator
  on public.mechanicy (warsztat_id)
  where rola = 'administrator' and usuniete_o is null;

-- ---------------------------------------------------------------------
--  3. Zaproszenie nie moze wepchnac drugiego administratora
--
--  Kod zaproszenia wystawiony na istniejacy warsztat, ktory ma juz swojego
--  administratora, zaklada konto zwyklego mechanika. Lepsze to niz blad
--  indeksu w twarz osoby, ktora wlasnie kupila usluge.
-- ---------------------------------------------------------------------
create or replace function public.aktywuj_zaproszenie(p_urzadzenie uuid, p_kod text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare
  z public.zaproszenia%rowtype;
  v_warsztat uuid;
  v_mechanik uuid;
  v_rola text;
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

  v_rola := z.rola;
  if v_rola = 'administrator' and exists (
       select 1 from public.mechanicy
        where warsztat_id = v_warsztat and rola = 'administrator' and usuniete_o is null)
  then
    v_rola := 'mechanik';
  end if;

  insert into public.mechanicy (warsztat_id, imie, rola)
  values (v_warsztat, z.imie, v_rola)
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
          jsonb_build_object('warsztat', v_warsztat, 'mechanik', v_mechanik, 'rola', v_rola));

  return jsonb_build_object('ok', true, 'warsztat', v_warsztat, 'mechanik', v_mechanik);
end $fn$;

-- ---------------------------------------------------------------------
--  4. Lista dla administratora - z imieniem podanym przez mechanika
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
               'imie', u.imie_zgloszone,
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
--  5. ZATWIERDZENIE JEDNYM KLIKIEM
--
--  Administrator podaje wylacznie kod wiersza, ktory dotknal. Konto zaklada
--  sie z imienia wpisanego przez mechanika na jego wlasnym telefonie.
--
--  Ponowne parowanie tej samej osoby (nowy telefon, reinstalacja) trafia
--  do ISTNIEJACEGO konta, jesli imie zgadza sie co do znaku po pominieciu
--  wielkosci liter i spacji. Dzieki temu historia i dziennik dostepu nie
--  rozpadaja sie na dwa konta tego samego czlowieka.
--
--  Konto z ODEBRANYM dostepem nie jest po cichu wskrzeszane - administrator
--  dostaje komunikat i musi swiadomie przywrocic dostep na liscie. Inaczej
--  zwolniony mechanik odzyskiwalby dostep sam, wpisujac swoje nazwisko.
-- ---------------------------------------------------------------------
create or replace function public.admin_zatwierdz_urzadzenie(
  p_wykonawca uuid, p_kod text
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare
  v_warsztat uuid;
  u          public.urzadzenia%rowtype;
  v_imie     text;
  v_mechanik uuid;
  v_zablokowany timestamptz;
  v_nowe     boolean := false;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);

  select * into u from public.urzadzenia
   where kod_parowania = upper(btrim(p_kod))
     and przyznany_o is null
     and usuniete_o is null
     and kod_wygasa_o > now()
   for update;

  if not found then
    return jsonb_build_object('ok', false,
      'blad', 'Ten telefon juz nie czeka na dostep - kod zostal uzyty albo wygasl');
  end if;

  v_imie := nullif(btrim(coalesce(u.imie_zgloszone, '')), '');
  if v_imie is null then
    return jsonb_build_object('ok', false,
      'blad', 'Ten telefon nie podal imienia i nazwiska. Popros o ponowne zgloszenie.');
  end if;

  -- Konto tej samej osoby, jesli juz istnieje.
  select id, zablokowany_o into v_mechanik, v_zablokowany
    from public.mechanicy
   where warsztat_id = v_warsztat
     and usuniete_o is null
     and lower(btrim(imie)) = lower(v_imie)
   order by utworzono
   limit 1;

  if v_mechanik is not null and v_zablokowany is not null then
    return jsonb_build_object('ok', false,
      'blad', v_imie || ' ma odebrany dostep. Najpierw przywroc go na liscie mechanikow.');
  end if;

  if v_mechanik is null then
    -- Zawsze "mechanik": administrator w warsztacie jest dokladnie jeden.
    insert into public.mechanicy (warsztat_id, imie, rola)
    values (v_warsztat, v_imie, 'mechanik')
    returning id into v_mechanik;
    v_nowe := true;
  end if;

  update public.urzadzenia
     set mechanik_id = v_mechanik,
         warsztat_id = v_warsztat,
         przyznany_o = now(),
         przyznany_przez = p_wykonawca::text,
         zablokowane_o = null,
         powod_blokady = null,
         zadanie_wyczyszczenia_o = null,
         zadanie_resetu_hasla_o = now()   -- mechanik ustawi wlasne haslo
   where id = u.id;

  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (p_wykonawca::text, 'zatwierdzenie_urzadzenia',
          jsonb_build_object('urzadzenie', u.id, 'mechanik', v_mechanik,
                             'nowe_konto', v_nowe));

  return jsonb_build_object('ok', true, 'mechanik', v_mechanik,
                            'imie', v_imie, 'nowe_konto', v_nowe);
end $fn$;

-- ---------------------------------------------------------------------
--  6. Recznie zalozone konto nie moze byc administratorem
-- ---------------------------------------------------------------------
create or replace function public.admin_dodaj_mechanika(
  p_wykonawca uuid, p_imie text, p_rola text default 'mechanik'
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
declare v_warsztat uuid; v_id uuid; v_rola text;
begin
  v_warsztat := public.sprawdz_admina(p_wykonawca);
  v_rola := case when p_rola in ('mechanik','kierownik') then p_rola else 'mechanik' end;

  if p_rola = 'administrator' then
    return jsonb_build_object('ok', false,
      'blad', 'Warsztat ma dokladnie jednego administratora i nie da sie dodac drugiego');
  end if;

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

grant execute on all routines in schema public to service_role;
