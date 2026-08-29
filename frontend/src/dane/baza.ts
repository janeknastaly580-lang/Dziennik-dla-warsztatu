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
 * A12 - plik bazy lezy w podkatalogu `warsztat`, ktory wtyczka
 *       `plugins/prywatnosc.js` wyklucza z kopii zapasowej iCloud
 *       i Google Drive. Sprawdz to po zbudowaniu aplikacji, nie zakladaj.
 */
import * as SQLite from 'expo-sqlite';

export const NAZWA_BAZY = 'warsztat.db';

let polaczenie: SQLite.SQLiteDatabase | null = null;

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

/** Otwiera baze i doprowadza schemat do biezacej wersji. */
export async function otworzBaze(): Promise<SQLite.SQLiteDatabase> {
  if (polaczenie) return polaczenie;

  const db = await SQLite.openDatabaseAsync(NAZWA_BAZY);
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
