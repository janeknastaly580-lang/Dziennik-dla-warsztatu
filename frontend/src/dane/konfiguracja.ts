/**
 * Adres chmury i stale synchronizacji.
 *
 * A2 - w aplikacji jest WYLACZNIE klucz publiczny (anon). To swiadome:
 * klucz anon i tak jest publiczny z zalozenia, bo siedzi w paczce .apk/.ipa,
 * ktora kazdy moze rozpakowac. Dlatego w bazie nie daje on dostepu do
 * niczego - kazda tabela ma RLS bez zadnej polityki, a rola anon nie ma
 * nawet prawa wejscia do schematu. Sprawdzenie: supabase/testy/test-anon.ps1
 *
 * Klucz service_role NIE MA PRAWA znalezc sie w tym pliku ani w zadnym innym
 * pliku aplikacji mobilnej.
 */
import Constants from 'expo-constants';

type Dodatkowe = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const dodatkowe = ((Constants.expoConfig?.extra ?? {}) as Dodatkowe);

export const ADRES_CHMURY = (dodatkowe.supabaseUrl ?? '').replace(/\/+$/, '');
export const KLUCZ_PUBLICZNY = dodatkowe.supabaseAnonKey ?? '';

/** B10: wersja formatu wymiany danych. Serwer odrzuca zbyt stare aplikacje. */
export const WERSJA_SCHEMATU = 1;

/** Wersja aplikacji - trafia do panelu administratora. */
export const WERSJA_APLIKACJI = Constants.expoConfig?.version ?? '2.0.0';

/** D7: nie zalewamy lacza - jedna paczka zmian na raz. */
export const ZMIAN_NA_PACZKE = 50;
export const WIERSZY_NA_STRONE = 500;

/** D1/D7: minimalna przerwa miedzy kolejnymi automatycznymi synchronizacjami. */
export const MIN_PRZERWA_SYNC_MS = 20_000;
/** Co ile probowac w tle, gdy jest siec. */
export const OKRES_SYNC_MS = 120_000;

/** A5: po jakim czasie bezczynnosci aplikacja sama sie blokuje. */
export const BEZCZYNNOSC_MS = 5 * 60 * 1000;

/** A4/A5: po tylu nieudanych probach hasla aplikacja czysci lokalna baze. */
export const MAKS_PROB_HASLA = 10;

/** A4: zapasowa wartosc, dopoki serwer nie poda swojej (ustawienie warsztatu). */
export const DOMYSLNE_WYGASNIECIE_OFFLINE_DNI = 14;

/** A3: zapasowe okno historii, dopoki serwer nie poda swojego. */
export const DOMYSLNE_OKNO_DNI = 90;

export function czyChmuraSkonfigurowana(): boolean {
  return ADRES_CHMURY.startsWith('http') && KLUCZ_PUBLICZNY.length > 20;
}
