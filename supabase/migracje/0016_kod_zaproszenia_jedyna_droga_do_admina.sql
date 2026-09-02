-- =====================================================================
--  0016  Administratorem zostaje sie WYLACZNIE kodem zaproszenia.
--
--  CO BYLO NIE TAK
--
--  Migracja 0012 zapewnila, ze administrator w warsztacie jest dokladnie
--  jeden - pilnuje tego indeks unikalny `idx_jeden_administrator`. Ale
--  `aktywuj_zaproszenie` radzila sobie z drugim kodem administratorskim
--  po cichu: obnizala role do "mechanik", zakladala konto i ZUZYWALA kod.
--
--  Z zewnatrz wygladalo to jak sukces. Osoba, ktora dostala kod na
--  administratora, ladowala w programie jako zwykly mechanik, kod
--  przepadal, a nikt nie dostawal komunikatu, ze cos poszlo inaczej,
--  niz mial zamiar. Cicha zamiana uprawnien to najgorszy mozliwy wynik
--  operacji, ktora wprost dotyczy uprawnien.
--
--  JAK JEST TERAZ
--
--  Kod na role "administrator" wpisany w warsztacie, ktory JUZ ma
--  administratora, nie dziala w ogole - dokladnie tak samo jak kod juz
--  wykorzystany. Konto nie powstaje, urzadzenie nie dostaje dostepu,
--  a sam kod NIE zostaje zuzyty: jesli administrator kiedys odejdzie
--  i jego konto zostanie skasowane, ten sam kod bedzie dzialal dalej.
--
--  Kody na role "mechanik" i "kierownik" dzialaja bez zmian. Zwykla
--  droga do warsztatu to nadal prosba o dostep zatwierdzana przez
--  administratora jednym klikiem (0012); kod zaproszenia jest od tego,
--  zeby zalozyc warsztat i pierwsze konto.
--
--  B10: zmiana dotyczy wylacznie tresci funkcji. Schemat bez zmian,
--  starsza wersja aplikacji dziala dalej - dostaje tylko uczciwy blad
--  zamiast cichego obnizenia roli.
-- =====================================================================

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
  v_rola := z.rola;

  -- Warsztat z istniejacym administratorem odrzuca kod administratorski
  -- w calosci. Kod zostaje niezuzyty - zadziala, jesli konto administratora
  -- kiedys zniknie. Sprawdzenie ma sens tylko dla kodu wskazujacego
  -- istniejacy warsztat: kod bez `warsztat_id` dopiero go zaklada, wiec
  -- administratora z definicji jeszcze tam nie ma.
  if v_rola = 'administrator' and v_warsztat is not null and exists (
       select 1 from public.mechanicy
        where warsztat_id = v_warsztat
          and rola = 'administrator'
          and usuniete_o is null)
  then
    return jsonb_build_object('ok', false,
      'blad', 'Ten warsztat ma juz administratora - kod nie zadziala');
  end if;

  if v_warsztat is null then
    insert into public.warsztaty (nazwa, prefiks)
    values (coalesce(z.nazwa_warsztatu, 'Warsztat'), public.wolny_prefiks(z.prefiks))
    returning id into v_warsztat;
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
