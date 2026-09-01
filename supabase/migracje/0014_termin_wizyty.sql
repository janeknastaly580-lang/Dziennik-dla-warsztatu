-- =====================================================================
--  0014  Termin wizyty: godziny od-do.
--
--  Po co: czas trwania wizyty wybiera sie teraz palcem na siatce kalendarza
--  w aplikacji, a nie wpisuje z klawiatury. Dzien siedzial juz w kolumnie
--  `data_wizyty` - brakowalo samych godzin.
--
--  B10: zmiana WYLACZNIE addytywna. Obie kolumny sa nullable, wiec starsza
--  wersja aplikacji dziala na tej samej bazie bez zmian, a wizyty zalozone
--  przed kalendarzem po prostu nie maja godzin i nie pokazuja sie w grafiku.
-- =====================================================================

alter table public.wizyty add column if not exists godzina_od time;
alter table public.wizyty add column if not exists godzina_do time;

-- Koniec nie moze byc przed poczatkiem. Warunek celowo NIE wymaga, zeby
-- obie godziny przyszly razem: telefon wysyla tylko zmienione kolumny (B1),
-- wiec przesuniecie samego konca to jeden klucz w ladunku. Wymaganie pary
-- wpychaloby taki - poprawny - zapis do kwarantanny.
alter table public.wizyty drop constraint if exists wizyty_godziny_po_kolei;
alter table public.wizyty add constraint wizyty_godziny_po_kolei
  check (godzina_od is null or godzina_do is null or godzina_do > godzina_od);

-- Grafik dnia czyta sie po warsztacie, dniu i godzinie rozpoczecia.
create index if not exists idx_wizyty_termin
  on public.wizyty (warsztat_id, data_wizyty, godzina_od);

-- ---------------------------------------------------------------------
-- B13  Lista dozwolonych kolumn - dochodza dwie godziny, reszta bez zmian.
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
            'data_wizyty','godzina_od','godzina_do','data_zamkniecia',
            'przebieg','koszt','numer_roboczy']
    else array[]::text[]
  end
$fn$;
