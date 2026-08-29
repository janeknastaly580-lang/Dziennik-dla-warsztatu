-- =====================================================================
--  0006  B8 - ostry warunek na kluczu idempotencji byl pulapka
--
--  Wstawienie do tabeli `operacje` dzieje sie POZA blokiem lapiacym wyjatki
--  w funkcji zapisz_z_telefonu(). Zbyt krotki klucz wysadzalby wiec cala
--  operacje JUZ PO zapisaniu danych - telefon dostalby blad 5xx i ponawialby
--  w nieskonczonosc, czyli dokladnie to, czego B8 zabrania.
--
--  Klucz i tak powstaje po stronie Edge Function w formacie
--  "<urzadzenie>:<pozycja kolejki>", wiec wystarczy ograniczenie dlugosci.
-- =====================================================================

alter table public.operacje drop constraint if exists operacje_klucz_check;
alter table public.operacje
  add constraint operacje_klucz_check check (length(klucz) between 1 and 200);
