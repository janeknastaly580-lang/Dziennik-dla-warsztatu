-- =====================================================================
--  0001  Schemat bazy warsztatu w Supabase (Postgres)
--
--  Zasady, ktore ten schemat wymusza:
--   B2  nigdy nie kasujemy fizycznie - tylko `usuniete_o`
--   B4  zero kolumn agregujacych - liczniki liczy sie COUNT() przy odczycie
--   B5  klucze glowne to UUID nadawane na telefonie; numer oficjalny
--       nadaje serwer
--   B6  `zrobione_o` (zegar telefonu) i `zapisane_o` (zegar serwera);
--       trigger przycina zrobione_o do zapisane_o
--   B13 ograniczenia CHECK na kazdym polu przyjmowanym z telefonu
--
--  W bazie NIE MA zdjec ani zadnych plikow binarnych - swiadoma decyzja
--  projektowa (znikaja ryzyka A7, A8, B7, C3, D6).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funkcje pomocnicze (musza istniec przed kolumnami generowanymi)
-- ---------------------------------------------------------------------

-- Telefon sprowadzony do samych cyfr - klucz naturalny do wykrywania
-- duplikatow kartotek (B3).  "+48 601-234-567" -> "48601234567"
create or replace function public.norm_telefon(t text)
returns text language sql immutable as $fn$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')
$fn$;

-- Tekst sprowadzony do postaci porownywalnej: male litery, bez polskich
-- znakow, bez spacji i interpunkcji.  "KR 12345" -> "kr12345"
create or replace function public.norm_tekst(t text)
returns text language sql immutable as $fn$
  select nullif(
    regexp_replace(
      lower(translate(coalesce(t, ''),
                      'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
                      'acelnoszzACELNOSZZ')),
      '[^a-z0-9]', '', 'g'),
    '')
$fn$;

-- Znaczniki czasu dla tabel danych.
-- B6: telefon z przestawionym zegarem nie moze twierdzic, ze wpis powstal
-- pozniej, niz dotarl na serwer.
create or replace function public.trg_znaczniki()
returns trigger language plpgsql as $fn$
begin
  new.zapisane_o := now();
  if new.zrobione_o is null then
    new.zrobione_o := new.zapisane_o;
  elsif new.zrobione_o > new.zapisane_o then
    new.zrobione_o := new.zapisane_o;
  end if;
  return new;
end $fn$;

-- Znacznik `zapisane_o` dla tabel bez zdarzenia po stronie telefonu.
create or replace function public.trg_zapisane_o()
returns trigger language plpgsql as $fn$
begin
  new.zapisane_o := now();
  return new;
end $fn$;

-- ---------------------------------------------------------------------
-- WARSZTATY  (najwyzszy poziom izolacji danych - "bucket" synchronizacji)
-- ---------------------------------------------------------------------
create table if not exists public.warsztaty (
  id           uuid primary key default gen_random_uuid(),
  nazwa        text not null check (length(btrim(nazwa)) between 1 and 200),
  -- B5: prefiks numeru roboczego, rozny dla kazdego warsztatu
  prefiks      text not null unique check (prefiks ~ '^[A-Z0-9]{1,4}$'),
  -- A3: okno synchronizacji - ile dni historii trafia na telefony
  okno_dni     integer not null default 90 check (okno_dni between 7 and 3650),
  -- B2: po ilu dniach zadanie serwerowe kasuje fizycznie rekordy oznaczone
  --     jako usuniete
  retencja_dni integer not null default 365 check (retencja_dni between 30 and 3650),
  -- A4: po ilu dniach bez synchronizacji telefon sam czysci lokalna baze
  wygasniecie_offline_dni integer not null default 14
                 check (wygasniecie_offline_dni between 1 and 90),
  utworzono    timestamptz not null default now(),
  zapisane_o   timestamptz not null default now(),
  usuniete_o   timestamptz
);

-- ---------------------------------------------------------------------
-- MECHANICY  (konta ludzi; dostep przyznaje i odbiera administrator)
-- ---------------------------------------------------------------------
create table if not exists public.mechanicy (
  id            uuid primary key default gen_random_uuid(),
  warsztat_id   uuid not null references public.warsztaty(id),
  imie          text not null check (length(btrim(imie)) between 1 and 120),
  rola          text not null default 'mechanik'
                  check (rola in ('mechanik', 'kierownik')),
  -- A6: blokada konta odcina wszystkie urzadzenia tego mechanika
  zablokowany_o timestamptz,
  powod_blokady text check (length(powod_blokady) <= 500),
  utworzono     timestamptz not null default now(),
  zapisane_o    timestamptz not null default now(),
  usuniete_o    timestamptz
);

-- ---------------------------------------------------------------------
-- URZADZENIA  (telefony; jedno urzadzenie = jedna sesja)
--
--  Przebieg parowania (dostep przyznawany zdalnie, jednorazowo):
--   1. telefon prosi o parowanie -> dostaje KOD (pokazuje go na ekranie)
--      i SEKRET (trzyma u siebie, nigdzie nie pokazuje),
--   2. administrator widzi kod w panelu i przypisuje urzadzenie
--      do konkretnego mechanika  ->  `przyznany_o`,
--   3. telefon odpytuje sekretem i JEDEN RAZ odbiera token urzadzenia;
--      kod i sekret sa wtedy kasowane,
--   4. mechanik ustawia na telefonie dowolne haslo (blokada aplikacji).
--
--  D1: token urzadzenia NIE WYGASA sam z siebie - brak sieci nigdy nie
--      wylogowuje mechanika. Uniewaznia go wylacznie administrator.
-- ---------------------------------------------------------------------
create table if not exists public.urzadzenia (
  id                uuid primary key default gen_random_uuid(),
  warsztat_id       uuid references public.warsztaty(id),
  mechanik_id       uuid references public.mechanicy(id),

  -- parowanie
  kod_parowania     text unique check (kod_parowania ~ '^[A-Z0-9]{8}$'),
  sekret_hash       text,
  kod_wygasa_o      timestamptz,
  przyznany_o       timestamptz,
  przyznany_przez   text check (length(przyznany_przez) <= 120),

  -- sesja
  token_hash        text unique,
  token_wydany_o    timestamptz,

  -- metadane (bez danych osobowych - A11)
  nazwa_urzadzenia  text check (length(nazwa_urzadzenia) <= 120),
  platforma         text check (platforma in ('ios', 'android', 'web', 'inne')),
  wersja_aplikacji  text check (length(wersja_aplikacji) <= 40),
  wersja_schematu   integer check (wersja_schematu between 1 and 10000),
  ostatni_kontakt_o timestamptz,
  ostatnia_sync_o   timestamptz,

  -- polecenia zdalne
  zablokowane_o           timestamptz,
  powod_blokady           text check (length(powod_blokady) <= 500),
  zadanie_wyczyszczenia_o timestamptz,   -- A4: zdalne skasowanie lokalnej bazy
  zadanie_resetu_hasla_o  timestamptz,   -- mechanik ustawi nowe haslo

  utworzono         timestamptz not null default now(),
  zapisane_o        timestamptz not null default now(),
  usuniete_o        timestamptz
);

-- ---------------------------------------------------------------------
-- KLIENCI
-- ---------------------------------------------------------------------
create table if not exists public.klienci (
  id           uuid primary key default gen_random_uuid(),
  warsztat_id  uuid not null references public.warsztaty(id),
  nazwa        text not null check (length(btrim(nazwa)) between 1 and 200),
  telefon      text check (length(telefon) <= 40),
  email        text check (length(email) <= 200),
  adres        text check (length(adres) <= 300),
  nip          text check (length(nip) <= 20),
  notatki      text check (length(notatki) <= 4000),

  -- B3: klucze naturalne do wykrywania duplikatow zalozonych offline
  telefon_norm text generated always as (public.norm_telefon(telefon)) stored,
  nazwa_norm   text generated always as (public.norm_tekst(nazwa)) stored,
  -- po scaleniu kartotek wskazuje kartoteke docelowa
  scalony_z    uuid references public.klienci(id),

  utworzono       timestamptz not null default now(),
  zrobione_o      timestamptz not null default now(),
  zapisane_o      timestamptz not null default now(),
  usuniete_o      timestamptz,                       -- B2: soft delete
  utworzone_przez uuid references public.mechanicy(id),
  zmienione_przez uuid references public.mechanicy(id)
);

-- ---------------------------------------------------------------------
-- WIZYTY / USTERKI
--   `auto` pozostaje swobodnym tekstem - bez kartoteki pojazdow.
-- ---------------------------------------------------------------------
create table if not exists public.wizyty (
  id              uuid primary key default gen_random_uuid(),
  warsztat_id     uuid not null references public.warsztaty(id),
  klient_id       uuid not null references public.klienci(id),

  auto            text check (length(auto) <= 500),
  auto_norm       text generated always as (public.norm_tekst(auto)) stored,
  tytul           text not null check (length(btrim(tytul)) between 1 and 200),
  opis            text check (length(opis) <= 8000),
  status          text not null default 'nienaprawione'
                    check (status in ('nienaprawione', 'w_trakcie', 'naprawione')),
  priorytet       text not null default 'normalny'
                    check (priorytet in ('niski', 'normalny', 'wysoki')),
  data_wizyty     date not null default current_date,
  data_zamkniecia date,
  przebieg        integer check (przebieg between 0 and 3000000),
  koszt           numeric(12, 2) check (koszt >= 0 and koszt <= 10000000),

  -- B5: numer roboczy nadaje telefon (z prefiksem warsztatu), numer
  --     oficjalny nadaje serwer przy pierwszym udanym zapisie
  numer_roboczy   text check (length(numer_roboczy) <= 40),
  numer_oficjalny text unique check (length(numer_oficjalny) <= 40),

  utworzono       timestamptz not null default now(),
  zrobione_o      timestamptz not null default now(),
  zapisane_o      timestamptz not null default now(),
  usuniete_o      timestamptz,                       -- B2: soft delete
  utworzone_przez uuid references public.mechanicy(id),
  zmienione_przez uuid references public.mechanicy(id)
);

-- ---------------------------------------------------------------------
-- B5  numeratory zlecen: jeden licznik na warsztat i rok
-- ---------------------------------------------------------------------
create table if not exists public.numeratory (
  warsztat_id uuid not null references public.warsztaty(id),
  rok         integer not null check (rok between 2000 and 2200),
  ostatni     integer not null default 0 check (ostatni >= 0),
  primary key (warsztat_id, rok)
);

-- ---------------------------------------------------------------------
-- B8  KWARANTANNA
--   Backend NIGDY nie odrzuca zapisu z telefonu trwalym bledem 4xx.
--   Wpis, ktorego nie da sie zastosowac, ladzie tutaj - kolejka na
--   telefonie idzie dalej i nie blokuje sie na jednym rekordzie.
-- ---------------------------------------------------------------------
create table if not exists public.kwarantanna (
  id            bigint generated always as identity primary key,
  warsztat_id   uuid,
  urzadzenie_id uuid,
  mechanik_id   uuid,
  tabela        text not null,
  rekord_id     uuid,
  operacja      text not null,
  ladunek       jsonb not null,
  blad          text not null,
  przyjete_o    timestamptz not null default now(),
  rozwiazane_o  timestamptz,
  rozwiazal     text,
  uwagi         text
);

-- ---------------------------------------------------------------------
-- B3  MOZLIWE DUPLIKATY - do recznego scalenia w panelu / aplikacji
-- ---------------------------------------------------------------------
create table if not exists public.mozliwe_duplikaty (
  id           bigint generated always as identity primary key,
  warsztat_id  uuid not null,
  tabela       text not null,
  rekord_id    uuid not null,
  podobny_do   uuid not null,
  powod        text not null,
  wykryte_o    timestamptz not null default now(),
  rozwiazane_o timestamptz,
  unique (tabela, rekord_id, podobny_do)
);

-- ---------------------------------------------------------------------
-- B12 IDEMPOTENCJA - powtorzona wysylka tego samego zapisu nie tworzy
--     drugiego rekordu; serwer oddaje zapamietany wynik.
-- ---------------------------------------------------------------------
create table if not exists public.operacje (
  klucz         text primary key check (length(klucz) between 8 and 200),
  urzadzenie_id uuid,
  wynik         jsonb not null,
  kiedy         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- A10 DZIENNIK DOSTEPU - kto, kiedy, ktora kartoteke otworzyl
-- ---------------------------------------------------------------------
create table if not exists public.dziennik_dostepu (
  id            bigint generated always as identity primary key,
  warsztat_id   uuid not null,
  mechanik_id   uuid,
  urzadzenie_id uuid,
  akcja         text not null check (length(akcja) <= 60),
  klient_id     uuid,
  wizyta_id     uuid,
  kiedy         timestamptz not null default now(),
  zapisane_o    timestamptz not null default now()
);

-- Dziennik dzialan administratora (kto komu przyznal lub odebral dostep)
create table if not exists public.dziennik_admina (
  id        bigint generated always as identity primary key,
  kto       text not null check (length(kto) <= 120),
  akcja     text not null check (length(akcja) <= 60),
  szczegoly jsonb,
  kiedy     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Ograniczenie tempa parowania (obrona przed zgadywaniem kodow)
-- ---------------------------------------------------------------------
create table if not exists public.limity (
  klucz    text primary key,
  licznik  integer not null default 0,
  okno_do  timestamptz not null
);

-- ---------------------------------------------------------------------
-- TRIGGERY
-- ---------------------------------------------------------------------
drop trigger if exists trg_klienci_znaczniki on public.klienci;
create trigger trg_klienci_znaczniki before insert or update on public.klienci
  for each row execute function public.trg_znaczniki();

drop trigger if exists trg_wizyty_znaczniki on public.wizyty;
create trigger trg_wizyty_znaczniki before insert or update on public.wizyty
  for each row execute function public.trg_znaczniki();

drop trigger if exists trg_warsztaty_zapisane on public.warsztaty;
create trigger trg_warsztaty_zapisane before insert or update on public.warsztaty
  for each row execute function public.trg_zapisane_o();

drop trigger if exists trg_mechanicy_zapisane on public.mechanicy;
create trigger trg_mechanicy_zapisane before insert or update on public.mechanicy
  for each row execute function public.trg_zapisane_o();

drop trigger if exists trg_urzadzenia_zapisane on public.urzadzenia;
create trigger trg_urzadzenia_zapisane before insert or update on public.urzadzenia
  for each row execute function public.trg_zapisane_o();

drop trigger if exists trg_dziennik_zapisane on public.dziennik_dostepu;
create trigger trg_dziennik_zapisane before insert or update on public.dziennik_dostepu
  for each row execute function public.trg_zapisane_o();

-- ---------------------------------------------------------------------
-- INDEKSY
--   D10: wyszukiwanie i kursor synchronizacji nie moga skanowac tabeli
-- ---------------------------------------------------------------------
create index if not exists idx_klienci_warsztat
  on public.klienci (warsztat_id) where usuniete_o is null;
create index if not exists idx_klienci_kursor
  on public.klienci (warsztat_id, zapisane_o, id);
create index if not exists idx_klienci_telefon_norm
  on public.klienci (warsztat_id, telefon_norm) where usuniete_o is null;
create index if not exists idx_klienci_nazwa_norm
  on public.klienci (warsztat_id, nazwa_norm) where usuniete_o is null;

create index if not exists idx_wizyty_klient
  on public.wizyty (klient_id) where usuniete_o is null;
create index if not exists idx_wizyty_kursor
  on public.wizyty (warsztat_id, zapisane_o, id);
create index if not exists idx_wizyty_okno
  on public.wizyty (warsztat_id, data_wizyty desc);
create index if not exists idx_wizyty_otwarte
  on public.wizyty (warsztat_id, status)
  where usuniete_o is null and status <> 'naprawione';
create index if not exists idx_wizyty_auto_norm
  on public.wizyty (warsztat_id, auto_norm) where usuniete_o is null;

create index if not exists idx_urzadzenia_token    on public.urzadzenia (token_hash);
create index if not exists idx_urzadzenia_mechanik on public.urzadzenia (mechanik_id);
create index if not exists idx_mechanicy_warsztat  on public.mechanicy (warsztat_id);

create index if not exists idx_kwarantanna_otwarte
  on public.kwarantanna (warsztat_id, przyjete_o desc) where rozwiazane_o is null;
create index if not exists idx_duplikaty_otwarte
  on public.mozliwe_duplikaty (warsztat_id, wykryte_o desc) where rozwiazane_o is null;
create index if not exists idx_dziennik_dostepu_kiedy
  on public.dziennik_dostepu (warsztat_id, kiedy desc);
create index if not exists idx_operacje_kiedy on public.operacje (kiedy);
