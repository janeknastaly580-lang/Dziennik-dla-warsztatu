-- =====================================================================
--  0009  Security Advisor: SECURITY DEFINER wystawiona dla anona
--
--  `rls_auto_enable()` to fabryczna siatka bezpieczenstwa Supabase - event
--  trigger, ktory automatycznie wlacza RLS na kazdej nowo utworzonej tabeli
--  w schemacie public. Realizuje zasade "RLS bez wyjatkow", wiec ZOSTAJE.
--
--  Problem byl inny: miala EXECUTE dla roli PUBLIC, czyli byla widoczna pod
--  /rest/v1/rpc/rls_auto_enable dla klucza anon. Wywolanie i tak by sie nie
--  udalo (funkcja zwraca event_trigger), ale nie ma powodu jej wystawiac.
-- =====================================================================

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
