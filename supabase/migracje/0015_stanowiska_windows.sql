-- =====================================================================
--  0015  Warsztat pracuje na komputerach z Windowsem.
--
--  Aplikacja przestala byc programem na telefon: mechanicy uruchamiaja ja
--  jako zwykly program Windows. Kolumna `platforma` w tabeli urzadzen ma
--  liste dozwolonych wartosci, na ktorej 'windows' jeszcze nie bylo - bez
--  tej migracji pierwsze parowanie stanowiska konczyloby sie zapisem
--  'inne' albo bledem ograniczenia.
--
--  Stare wartosci zostaja na liscie SWIADOMIE: w bazie warsztatu, ktory
--  wczesniej pracowal na telefonach, sa juz wiersze z 'android' i 'ios'.
--  Migracja ma dopuscic nowa platforme, a nie przepisywac historii.
-- =====================================================================

alter table public.urzadzenia
  drop constraint if exists urzadzenia_platforma_check;

alter table public.urzadzenia
  add constraint urzadzenia_platforma_check
  check (platforma in ('windows', 'web', 'inne', 'ios', 'android'));
