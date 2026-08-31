/**
 * Lokalna baza SQLite na telefonie - JEDYNE zrodlo danych dla ekranow.
 *
 * D1 - To jest sedno odpornosci na brak sieci: ekrany NIGDY nie czytaja
 *      z sieci. Czytaja stad. Synchronizacja tylko dolewa i odlewa dane
 *      w tle. Brak zasiegu nie moze zablokowac pracy ani wylogowac
 *      mechanika.
 *
 * B2 - `usuniete_o` zamiast kasowania. To samo, co w chmurze.
 * B4 - zero kolumn z licznikami. Liczniki liczy COUNT() przy odczycie,
 *      wiec dwa telefony nie moga sobie nawzajem zgubic przyrostu.
 * D5 - kolumna `oczekuje` mowi, czy rekord czeka jeszcze na wyslanie.
 *      Z tego biora sie zegarek i ptaszek przy kafelkach.
 *
 * A4  - Plik bazy jest SZYFROWANY (SQLCipher) NA TELEFONIE. Klucza nie ma
 *       w kodzie:
 *       powstaje losowo przy pierwszym uruchomieniu i lezy w Keychain /
 *       Keystore z flaga "tylko to urzadzenie". Wyjecie karty pamieci albo
 *       skopiowanie pliku bazy z zgubionego telefonu daje szyfrogram.
 *       Wymaga wlasnego builda (app.json -> expo-sqlite: useSQLCipher).
 *       W PRZEGLADARCE SQLCipher nie istnieje - dlatego wersja webowa jest
 *       wylacznie podgladem interfejsu i mowi o tym wprost.
 *
 * A12 - Wtyczka `plugins/prywatnosc.js` wyklucza dane aplikacji z kopii
 *       zapasowej iCloud i Google Drive. Sprawdz to po zbudowaniu, nie zakladaj.
 */
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { TRYB_PODGLADU, czytaj, skasuj, zapisz } from './pamiecBezpieczna';

export const NAZWA_BAZY = 'warsztat.db';

const K_KLUCZ_BAZY = 'warsztat_klucz_bazy';

let polaczenie: SQLite.SQLiteDatabase | null = null;
/**
 * Trwajace otwarcie bazy. Bez tego dwa rownolegle wywolania `otworzBaze()`
 * (a takie zdarzaja sie przy starcie: kontekst aplikacji, sprawdzenie
 * wygasniecia offline i pierwszy odczyt ekranu ruszaja naraz) otwieraja
 * DWA polaczenia do tego samego pliku. Na telefonie konczy sie to blokada
 * zapisu, a w przegladarce rozjezdza sie inicjalizacja WebAssembly
 * w expo-sqlite i baza w ogole sie nie otwiera
 * ("Invalid VFS state", potem "Error code 14: unable to open database file").
 */
let otwieranie: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 256-bitowy klucz szyfrowania lokalnej bazy. Przy pierwszym uruchomieniu
 * losowany i zapisywany w bezpiecznym magazynie systemu; potem tylko czytany.
 */
async function kluczBazy(): Promise<string> {
  const istniejacy = await czytaj(K_KLUCZ_BAZY);
  if (istniejacy && /^[0-9a-f]{64}$/.test(istniejacy)) return istniejacy;

  const nowy = Array.from(Crypto.getRandomBytes(32))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  await zapisz(K_KLUCZ_BAZY, nowy);
  return nowy;
}

/**
 * Usuwa klucz - po tym stary plik bazy jest juz nie do odczytania.
 * Zamykamy tez polaczenie, zeby nastepne otwarcie zalozylo swiezy,
 * zaszyfrowany nowym kluczem plik zamiast pisac do starego.
 */
export async function skasujKluczBazy(): Promise<void> {
  await skasuj(K_KLUCZ_BAZY);
  try {
    await polaczenie?.closeAsync();
  } catch {
    // Zamkniecie i tak nie moze zablokowac wylogowania.
  }
  polaczenie = null;
  otwieranie = null;
  await SQLite.deleteDatabaseAsync(NAZWA_BAZY).catch(() => undefined);
}

/** Kolejne wersje schematu lokalnego. Zmiany WYLACZNIE addytywne (B10). */
const MIGRACJE: string[] = [
  // wersja 1
  `
  CREATE TABLE IF NOT EXISTS klienci (
    id          TEXT PRIMARY KEY NOT NULL,
    nazwa       TEXT NOT NULL,
    telefon     TEXT,
    email       TEXT,
    adres       TEXT,
    nip         TEXT,
    notatki     TEXT,
    zrobione_o  TEXT,
    zapisane_o  TEXT,
    usuniete_o  TEXT,
    oczekuje    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS wizyty (
    id              TEXT PRIMARY KEY NOT NULL,
    klient_id       TEXT NOT NULL,
    auto            TEXT,
    tytul           TEXT NOT NULL,
    opis            TEXT,
    status          TEXT NOT NULL DEFAULT 'nienaprawione',
    priorytet       TEXT NOT NULL DEFAULT 'normalny',
    data_wizyty     TEXT NOT NULL,
    data_zamkniecia TEXT,
    przebieg        INTEGER,
    koszt           REAL,
    numer_roboczy   TEXT,
    numer_oficjalny TEXT,
    zrobione_o      TEXT,
    zapisane_o      TEXT,
    usuniete_o      TEXT,
    oczekuje        INTEGER NOT NULL DEFAULT 0
  );

  -- B8: kolejka wysylkowa. Trwala - przezywa restart i awarie aplikacji.
  CREATE TABLE IF NOT EXISTS kolejka (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tabela       TEXT NOT NULL,
    rekord_id    TEXT NOT NULL,
    operacja     TEXT NOT NULL,
    pola         TEXT NOT NULL,
    zrobione_o   TEXT NOT NULL,
    proby        INTEGER NOT NULL DEFAULT 0,
    ostatni_blad TEXT,
    utworzono    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    klucz   TEXT PRIMARY KEY NOT NULL,
    wartosc TEXT
  );

  -- D10: bez indeksow lista klientow zaczyna zwalniac po kilku latach.
  CREATE INDEX IF NOT EXISTS idx_wizyty_klient ON wizyty (klient_id);
  CREATE INDEX IF NOT EXISTS idx_wizyty_status ON wizyty (status);
  CREATE INDEX IF NOT EXISTS idx_wizyty_data   ON wizyty (data_wizyty DESC);
  CREATE INDEX IF NOT EXISTS idx_klienci_nazwa ON klienci (nazwa);
  CREATE INDEX IF NOT EXISTS idx_kolejka_kolej ON kolejka (id);
  `,
];

/**
 * Otwiera zaszyfrowana baze i doprowadza schemat do biezacej wersji.
 *
 * `PRAGMA key` musi byc PIERWSZA instrukcja po otwarciu pliku - dopiero po
 * niej SQLCipher potrafi cokolwiek odczytac. Klucz podajemy w postaci surowej
 * (x'...'), wiec SQLCipher nie przepuszcza go przez wolne wyprowadzanie klucza
 * i nie ma tu miejsca na wstrzykniecie - to 64 znaki szesnastkowe.
 */
async function otworzZaszyfrowana(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(NAZWA_BAZY);

  // W przegladarce SQLite jest skompilowany do WebAssembly i nie ma w nim
  // SQLCipher - PRAGMA key wywalilaby otwarcie bazy. Tryb podgladu dziala
  // wiec bez szyfrowania, o czym aplikacja informuje paskiem na gorze ekranu.
  if (!TRYB_PODGLADU) {
    const klucz = await kluczBazy();
    await db.execAsync(`PRAGMA key = "x'${klucz}'"`);
  }
  // Odczyt czegokolwiek udaje sie tylko przy poprawnym kluczu - to jest
  // sprawdzenie, czy plik faktycznie da sie odszyfrowac.
  await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master');
  return db;
}

/**
 * Otwiera baze i doprowadza schemat do biezacej wersji.
 *
 * Rownolegle wywolania dostaja TO SAMO otwarcie - nigdy drugiego polaczenia
 * do tego samego pliku.
 */
export async function otworzBaze(): Promise<SQLite.SQLiteDatabase> {
  if (polaczenie) return polaczenie;
  if (!otwieranie) {
    otwieranie = otworzIZmigruj().finally(() => { otwieranie = null; });
  }
  return otwieranie;
}

async function otworzIZmigruj(): Promise<SQLite.SQLiteDatabase> {
  let db: SQLite.SQLiteDatabase;
  try {
    db = await otworzZaszyfrowana();
  } catch {
    // Plik jest nie do odczytania tym kluczem: zostal po starszej, nieszyfrowanej
    // wersji aplikacji albo klucz zniknal z Keychain. Lokalna baza jest kopia
    // robocza danych z serwera, wiec zakladamy ja od nowa i synchronizujemy.
    // Niewyslane zmiany z takiej bazy i tak bylyby nieczytelne.
    await SQLite.deleteDatabaseAsync(NAZWA_BAZY).catch(() => undefined);
    db = await otworzZaszyfrowana();
  }

  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');

  const wiersz = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const wersja = wiersz?.user_version ?? 0;

  for (let i = wersja; i < MIGRACJE.length; i += 1) {
    await db.execAsync(MIGRACJE[i]);
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }

  polaczenie = db;
  return db;
}

export async function baza(): Promise<SQLite.SQLiteDatabase> {
  return polaczenie ?? otworzBaze();
}

/* ----------------------------- pamiec podreczna ------------------------ */

export async function ustawMeta(klucz: string, wartosc: string | null): Promise<void> {
  const db = await baza();
  await db.runAsync(
    'INSERT INTO meta (klucz, wartosc) VALUES (?, ?) ' +
    'ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc',
    klucz, wartosc,
  );
}

export async function pobierzMeta(klucz: string): Promise<string | null> {
  const db = await baza();
  const w = await db.getFirstAsync<{ wartosc: string | null }>(
    'SELECT wartosc FROM meta WHERE klucz = ?', klucz,
  );
  return w?.wartosc ?? null;
}

export async function ustawMetaJson(klucz: string, wartosc: unknown): Promise<void> {
  await ustawMeta(klucz, wartosc === null || wartosc === undefined ? null : JSON.stringify(wartosc));
}

export async function pobierzMetaJson<T>(klucz: string, domyslna: T): Promise<T> {
  const t = await pobierzMeta(klucz);
  if (!t) return domyslna;
  try {
    return JSON.parse(t) as T;
  } catch {
    return domyslna;
  }
}

/* ------------------------------ czyszczenie ---------------------------- */

/**
 * A4 / A6 - calkowite skasowanie danych warsztatu z telefonu.
 *
 * Wywolywane, gdy:
 *   - administrator zablokowal dostep albo kazal wyczyscic urzadzenie,
 *   - telefon nie synchronizowal sie dluzej niz okno offline warsztatu
 *     (skradziony telefon juz nigdy sie nie polaczy, wiec sam sie wyczysci),
 *   - mechanik sie wylogowal,
 *   - ktos probowal zgadnac haslo zbyt wiele razy.
 *
 * Kolejka tez ginie - to swiadomy wybor. Jesli dostep zostal odebrany,
 * niewyslane zmiany nie maja juz gdzie trafic, a zostawienie ich na
 * telefonie oznaczaloby zostawienie danych osobowych klientow.
 */
export async function wyczyscDaneWarsztatu(): Promise<void> {
  const db = await baza();
  await db.execAsync(`
    DELETE FROM wizyty;
    DELETE FROM klienci;
    DELETE FROM kolejka;
    DELETE FROM meta;
    VACUUM;
  `);
}
