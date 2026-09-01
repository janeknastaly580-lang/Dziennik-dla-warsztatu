/**
 * Adres chmury i stale synchronizacji.
 *
 * A2 - w aplikacji jest WYLACZNIE klucz publiczny (publishable albo anon).
 * To swiadome: taki klucz i tak jest publiczny z zalozenia, bo siedzi
 * w paczce .apk/.ipa, ktora kazdy moze rozpakowac. Dlatego w bazie nie daje
 * on dostepu do niczego - kazda tabela ma RLS bez zadnej polityki, a role
 * anon i authenticated nie maja nawet prawa wejscia do schematu.
 * Sprawdzenie: supabase/testy/test-anon.ps1
 *
 * Wartosci przychodza z frontend/.env (zmienne EXPO_PUBLIC_*) przez
 * app.config.js, ktory PRZERYWA BUILD, jesli ktos wklei tam klucz
 * service_role albo sb_secret_. Klucze sekretne mieszkaja wylacznie
 * w narzedzia/.env i w sekretach Edge Functions.
 */
import Constants from 'expo-constants';

type Dodatkowe = {
  supabaseUrl?: string;
  supabaseKluczPubliczny?: string;
  supabaseAnonKey?: string;
};

const dodatkowe = ((Constants.expoConfig?.extra ?? {}) as Dodatkowe);

export const ADRES_CHMURY = (dodatkowe.supabaseUrl ?? '').replace(/\/+$/, '');

/** Klucz publishable, a gdy go nie ma - starszy anon. Oba sa publiczne. */
export const KLUCZ_PUBLICZNY =
  dodatkowe.supabaseKluczPubliczny || dodatkowe.supabaseAnonKey || '';

/** B10: wersja formatu wymiany danych. Serwer odrzuca zbyt stare aplikacje. */
export const WERSJA_SCHEMATU = 1;

/** Wersja aplikacji - trafia do panelu administratora. */
export const WERSJA_APLIKACJI = Constants.expoConfig?.version ?? '2.0.0';

/** D7: nie zalewamy lacza - jedna paczka zmian na raz. */
export const ZMIAN_NA_PACZKE = 50;
export const WIERSZY_NA_STRONE = 500;

/**
 * D1/D7: minimalna przerwa miedzy kolejnymi automatycznymi synchronizacjami.
 *
 * Krotka celowo. Synchronizacja jest teraz niewidoczna - nie ma paska, ktory
 * mechanik moglby dotknac, wiec aplikacja musi sama pilnowac, zeby kolejka
 * nie rosla. Ta przerwa jest tylko bezpiecznikiem przed zalaniem serwera,
 * gdy ktos wprowadza dziesiec zmian pod rzad.
 */
export const MIN_PRZERWA_SYNC_MS = 4_000;
/** Co ile probowac w tle, gdy jest siec. */
export const OKRES_SYNC_MS = 45_000;

/** A4/A5: po tylu nieudanych probach hasla aplikacja czysci lokalna baze. */
export const MAKS_PROB_HASLA = 10;

/** A4: zapasowa wartosc, dopoki serwer nie poda swojej (ustawienie warsztatu). */
export const DOMYSLNE_WYGASNIECIE_OFFLINE_DNI = 14;

/** A3: zapasowe okno historii, dopoki serwer nie poda swojego. */
export const DOMYSLNE_OKNO_DNI = 90;

/**
 * Ile dni po oznaczeniu zgloszenia jako naprawione wolno je usunac.
 *
 * Aplikacja uzywa tej liczby tylko po to, zeby SCHOWAC przycisk i wyjasnic
 * mechanikowi dlaczego. Prawda jest po stronie bazy (kolumna
 * `warsztaty.karencja_usuwania_dni` i funkcja `mozna_usunac_wizyte`), wiec
 * nawet podmieniony zapis z telefonu odbije sie od serwera.
 */
export const KARENCJA_USUWANIA_DNI = 30;

/**
 * D7 - ponawianie po powrocie sieci.
 *
 * Gdy w kolejce cos czeka, probujemy czesciej niz zwykly cykl w tle, ale
 * z rosnaca przerwa: 5 s, 10 s, 20 s, 40 s... do 5 minut. Dzieki temu
 * krotka przerwa w zasiegu konczy sie dogonieniem serwera w kilka sekund,
 * a dluga awaria nie mieli baterii ani lacza.
 */
export const PONOWIENIE_MIN_MS = 5_000;
export const PONOWIENIE_MAKS_MS = 5 * 60 * 1000;

export function czyChmuraSkonfigurowana(): boolean {
  return ADRES_CHMURY.startsWith('http') && KLUCZ_PUBLICZNY.length > 20;
}
