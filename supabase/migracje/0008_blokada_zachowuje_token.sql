-- =====================================================================
--  0008  A6 - blokada ma MOWIC telefonowi, co sie stalo
--
--  Pierwsza wersja kasowala token_hash przy blokadzie. Skutek: telefon
--  dostawal anonimowe "nieznany token" i nie potrafil pokazac mechanikowi
--  powodu ani odroznic blokady od awarii. Administrator nie mogl tez zdjac
--  blokady bez ponownego parowania.
--
--  Teraz token zostaje, ale nie daje juz dostepu do niczego:
--  uwierzytelnij_urzadzenie() zwraca zablokowane = true, a funkcja sync
--  odmawia pull i push, oddajac telefonowi jawny komunikat z powodem.
--  Trwale uniewaznienie sesji robi osobna funkcja wyrejestruj_urzadzenie().
-- =====================================================================

create or replace function public.zablokuj_urzadzenie(
  p_urzadzenie uuid, p_powod text, p_kto text, p_wyczysc boolean default true
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
begin
  update public.urzadzenia
     set zablokowane_o = now(),
         powod_blokady = left(coalesce(p_powod, 'brak podanego powodu'), 500),
         zadanie_wyczyszczenia_o = case when p_wyczysc then now() else null end
   where id = p_urzadzenie;
  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'blokada_urzadzenia',
          jsonb_build_object('urzadzenie', p_urzadzenie, 'wyczysc', p_wyczysc));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.zablokuj_mechanika(
  p_mechanik uuid, p_powod text, p_kto text, p_wyczysc boolean default true
)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
begin
  update public.mechanicy
     set zablokowany_o = now(),
         powod_blokady = left(coalesce(p_powod, 'brak podanego powodu'), 500)
   where id = p_mechanik;
  update public.urzadzenia
     set zablokowane_o = now(),
         powod_blokady = left(coalesce(p_powod, 'konto zablokowane'), 500),
         zadanie_wyczyszczenia_o = case when p_wyczysc then now() else null end
   where mechanik_id = p_mechanik;
  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'blokada_mechanika',
          jsonb_build_object('mechanik', p_mechanik, 'wyczysc', p_wyczysc));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.odblokuj_mechanika(p_mechanik uuid, p_kto text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
begin
  update public.mechanicy
     set zablokowany_o = null, powod_blokady = null
   where id = p_mechanik;
  update public.urzadzenia
     set zablokowane_o = null, powod_blokady = null, zadanie_wyczyszczenia_o = null
   where mechanik_id = p_mechanik and token_hash is not null;
  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'odblokowanie_mechanika',
          jsonb_build_object('mechanik', p_mechanik));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.odblokuj_urzadzenie(p_urzadzenie uuid, p_kto text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
begin
  update public.urzadzenia
     set zablokowane_o = null, powod_blokady = null, zadanie_wyczyszczenia_o = null
   where id = p_urzadzenie;
  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'odblokowanie_urzadzenia',
          jsonb_build_object('urzadzenie', p_urzadzenie));
  return jsonb_build_object('ok', true);
end $fn$;

-- A4: telefon zgubiony na dobre - sesja gasnie na stale, powrot wymaga
-- ponownego parowania i zgody administratora.
create or replace function public.wyrejestruj_urzadzenie(p_urzadzenie uuid, p_kto text)
returns jsonb language plpgsql set search_path = pg_catalog, public as $fn$
begin
  update public.urzadzenia
     set token_hash = null, kod_parowania = null, sekret_hash = null,
         zablokowane_o = now(), powod_blokady = 'urzadzenie wyrejestrowane',
         usuniete_o = now()
   where id = p_urzadzenie;
  insert into public.dziennik_admina (kto, akcja, szczegoly)
  values (left(coalesce(p_kto, 'administrator'), 120), 'wyrejestrowanie_urzadzenia',
          jsonb_build_object('urzadzenie', p_urzadzenie));
  return jsonb_build_object('ok', true);
end $fn$;

grant execute on all routines in schema public to service_role;
