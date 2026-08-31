/**
 * Konfiguracja Expo liczona przy budowaniu.
 *
 * Statyczna czesc siedzi w `app.json`; tutaj dokladamy wylacznie to, co
 * pochodzi ze zmiennych srodowiskowych — czyli adres projektu Supabase
 * i KLUCZ PUBLICZNY.
 *
 * Dlaczego objasnienia sa TUTAJ, a nie w app.json: JSON nie ma komentarzy,
 * a schemat konfiguracji Expo odrzuca dodatkowe pola (nawet nazwane "//").
 * `npx expo-doctor` zglaszal je jako blad, wiec opisy zyja w tym pliku.
 *
 * WERSJA WEBOWA sluzy wylacznie do podgladu interfejsu na localhost.
 * W przegladarce nie ma Keychain/Keystore ani SQLCipher, wiec aplikacja
 * mowi o tym paskiem ostrzegawczym i nie nadaje sie do pracy na prawdziwych
 * danych klientow. Do warsztatu idzie APK / IPA.
 *
 * PODZIAL KLUCZY (ryzyko A2), pilnowany strażnikiem ponizej:
 *
 *   frontend/.env  →  tylko EXPO_PUBLIC_*  →  ląduje w paczce .apk/.ipa
 *                     adres + klucz publishable / anon
 *                     publiczne z definicji, nie dają dostępu do niczego
 *
 *   narzedzia/.env →  service_role         →  NIGDY nie opuszcza komputera
 *   sekrety Supabase                          dostawcy ani serwera Supabase
 *
 * Jeśli ktoś kiedyś wklei do frontend/.env klucz `service_role` albo
 * `sb_secret_...`, build przerwie się tutaj z głośnym komunikatem — zanim
 * sekret trafi do paczki, którą da się rozpakować.
 */

/* ---------------------------------------------------------------------
 *  ADRES CHMURY WPISANY NA STALE
 *
 *  Aplikacja NIGDY nie pyta uzytkownika o adres serwera - ani na telefonie,
 *  ani w przegladarce. Te trzy wartosci sa tu wpisane wprost, zeby po
 *  sciagnieciu repozytorium wystarczylo `npm start` albo `eas build`, bez
 *  kopiowania zadnego pliku i bez wklejania czegokolwiek na ekranie.
 *
 *  Mozna je nadpisac przez frontend/.env (zmienne EXPO_PUBLIC_*) - to jedyny
 *  potrzebny ruch, gdy warsztat przenosi sie na inny projekt Supabase.
 *
 *  Dlaczego wolno je trzymac w repozytorium: to sa klucze PUBLICZNE. Expo
 *  i tak wkleja je na stale do paczki .apk / .ipa, a paczke da sie rozpakowac
 *  w kilka minut. W bazie nie daja dostepu do niczego - kazda tabela ma RLS
 *  bez zadnej polityki, role anon i authenticated nie maja wstepu do schematu
 *  public, a dane wydaje wylacznie funkcja brzegowa po sprawdzeniu tokenu
 *  urzadzenia. Sprawdzenie: supabase/testy/test-anon.ps1
 * ------------------------------------------------------------------- */

const DOMYSLNY_ADRES = 'https://tpigqlvwjatlkhfqtlkt.supabase.co';

const DOMYSLNY_KLUCZ_PUBLISHABLE = 'sb_publishable_pcwvkAD9XVEG9sDT0RGScQ_6p5UTZwt';

const DOMYSLNY_KLUCZ_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaWdxbHZ3'
  + 'amF0bGtoZnF0bGt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjE0MTMsImV4cCI6MjEwMzU5NzQx'
  + 'M30.EzdtM7UGsdyIlKuAX7JMY12jrxGuVWy6OOmRajn1MxY';

/** Czy ten JWT ma w środku rolę inną niż `anon`? */
function rolaWTokenie(klucz) {
  const czesci = String(klucz).split('.');
  if (czesci.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(czesci[1], 'base64').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

function sprawdzKlucz(nazwa, klucz) {
  if (!klucz) return;

  if (klucz.startsWith('sb_secret_')) {
    throw new Error(
      `\n\n  ${nazwa} zawiera klucz SEKRETNY (sb_secret_...).\n`
      + '  Ten klucz omija wszystkie zabezpieczenia bazy, a paczka aplikacji\n'
      + '  jest publiczna. Przenies go do narzedzia/.env i wstaw tutaj klucz\n'
      + '  publishable albo anon.\n',
    );
  }

  const rola = rolaWTokenie(klucz);
  if (rola && rola !== 'anon') {
    throw new Error(
      `\n\n  ${nazwa} zawiera token z rola "${rola}", a nie "anon".\n`
      + '  Klucz service_role nie moze trafic do aplikacji mobilnej - kazdy,\n'
      + '  kto rozpakuje .apk, mialby wtedy cala baze klientow.\n'
      + '  Jesli ten klucz gdzies juz wyciekl: ZROTUJ go w panelu Supabase.\n',
    );
  }
}

module.exports = ({ config }) => {
  // Zmienna ze srodowiska wygrywa; bez niej idzie wartosc wpisana wyzej.
  const adres = (process.env.EXPO_PUBLIC_SUPABASE_URL || DOMYSLNY_ADRES).replace(/\/+$/, '');
  const publishable =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DOMYSLNY_KLUCZ_PUBLISHABLE;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DOMYSLNY_KLUCZ_ANON;

  sprawdzKlucz('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', publishable);
  sprawdzKlucz('EXPO_PUBLIC_SUPABASE_ANON_KEY', anon);

  if (!adres || (!publishable && !anon)) {
    throw new Error(
      '\n\n  Aplikacja nie ma adresu serwera ani klucza publicznego.\n'
      + '  Uzupelnij DOMYSLNY_ADRES w frontend/app.config.js albo zmienne\n'
      + '  EXPO_PUBLIC_SUPABASE_* w frontend/.env.\n',
    );
  }

  return {
    ...config,
    extra: {
      ...config.extra,
      supabaseUrl: adres,
      // Aplikacja woli klucz publishable; anon zostaje jako zapas.
      supabaseKluczPubliczny: publishable || anon,
      supabaseAnonKey: anon,
    },
  };
};
