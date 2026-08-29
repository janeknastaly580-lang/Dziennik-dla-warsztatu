/**
 * Odczyt i zapis danych warsztatu - wszystko na lokalnej bazie telefonu.
 *
 * Zadna funkcja z tego pliku nie dotyka sieci. Zapis konczy sie w chwili,
 * gdy dane sa w SQLite; wyslanie na serwer to osobna sprawa, ktora dzieje
 * sie w tle (patrz synchronizacja.ts). Dzieki temu praca w warsztacie bez
 * zasiegu wyglada dokladnie tak samo jak z zasiegiem (D1).
 */
import * as Crypto from 'expo-crypto';

import { baza, pobierzMeta, ustawMeta } from './baza';
import { dodajDoKolejki } from './kolejka';
import type {
  Auto, Klient, KlientNaLiscie, Priorytet, Status, Wizyta,
} from '../typy';

const teraz = () => new Date().toISOString();

/** B5/B12: identyfikator powstaje na telefonie i nie zmienia sie nigdy - ani
 *  przy ponowieniu wysylki, ani po stronie serwera. */
export const nowyId = (): string => Crypto.randomUUID();

/* ====================================================================== */
/*  ODCZYT                                                                */
/* ====================================================================== */

/**
 * Pelna lista klientow z licznikami.
 * B4: liczniki sa liczone COUNT-em przy kazdym odczycie, a nie trzymane
 * w kolumnie. Dwa telefony offline nie moga sobie zgubic przyrostu.
 */
export async function listaKlientow(): Promise<KlientNaLiscie[]> {
  const db = await baza();
  return db.getAllAsync<KlientNaLiscie>(`
    SELECT
      k.id, k.nazwa, k.telefon, k.email, k.adres, k.oczekuje,
      (SELECT COUNT(*) FROM wizyty w
        WHERE w.klient_id = k.id AND w.usuniete_o IS NULL)              AS liczba_wizyt,
      (SELECT COUNT(*) FROM wizyty w
        WHERE w.klient_id = k.id AND w.usuniete_o IS NULL
          AND w.status <> 'naprawione')                                 AS liczba_otwartych,
      (SELECT COUNT(DISTINCT TRIM(w.auto)) FROM wizyty w
        WHERE w.klient_id = k.id AND w.usuniete_o IS NULL
          AND TRIM(COALESCE(w.auto,'')) <> '')                          AS liczba_aut,
      (SELECT GROUP_CONCAT(DISTINCT TRIM(w.auto)) FROM wizyty w
        WHERE w.klient_id = k.id AND w.usuniete_o IS NULL
          AND TRIM(COALESCE(w.auto,'')) <> '')                          AS auta,
      (SELECT MAX(w.data_wizyty) FROM wizyty w
        WHERE w.klient_id = k.id AND w.usuniete_o IS NULL)              AS ostatnia_wizyta
    FROM klienci k
    WHERE k.usuniete_o IS NULL
    ORDER BY liczba_otwartych DESC, k.nazwa COLLATE NOCASE ASC
  `);
}

const SQL_AUTA = `
  SELECT TRIM(auto) AS auto,
         COUNT(*) AS liczba_wizyt,
         SUM(CASE WHEN status <> 'naprawione' THEN 1 ELSE 0 END) AS liczba_otwartych
  FROM wizyty
  WHERE klient_id = ? AND usuniete_o IS NULL AND TRIM(COALESCE(auto,'')) <> ''
  GROUP BY TRIM(auto) COLLATE NOCASE
  ORDER BY liczba_otwartych DESC, auto COLLATE NOCASE ASC
`;

export async function autaKlienta(klientId: string): Promise<Auto[]> {
  const db = await baza();
  return db.getAllAsync<Auto>(SQL_AUTA, klientId);
}

export async function profilKlienta(id: string): Promise<Klient | null> {
  const db = await baza();
  const klient = await db.getFirstAsync<any>(
    'SELECT * FROM klienci WHERE id = ? AND usuniete_o IS NULL', id,
  );
  if (!klient) return null;

  const auta = await db.getAllAsync<Auto>(SQL_AUTA, id);
  const statystyki = await db.getFirstAsync<Klient['statystyki']>(`
    SELECT COUNT(*)                                                AS wizyty_razem,
           SUM(CASE WHEN status <> 'naprawione' THEN 1 ELSE 0 END) AS otwarte,
           SUM(CASE WHEN status =  'naprawione' THEN 1 ELSE 0 END) AS naprawione,
           COALESCE(SUM(koszt), 0)                                 AS koszt_razem
    FROM wizyty WHERE klient_id = ? AND usuniete_o IS NULL
  `, id);

  return { ...klient, auta, statystyki: statystyki ?? {
    wizyty_razem: 0, otwarte: 0, naprawione: 0, koszt_razem: 0,
  } };
}

/** Historia klienta; `auto` zaweza do jednej zakladki. */
export async function wizytyKlienta(klientId: string, auto?: string | null): Promise<Wizyta[]> {
  const db = await baza();
  const warunki = ['w.klient_id = ?', 'w.usuniete_o IS NULL'];
  const params: (string | number | null)[] = [klientId];
  if (auto) {
    warunki.push("TRIM(COALESCE(w.auto,'')) = ? COLLATE NOCASE");
    params.push(auto);
  }
  return db.getAllAsync<Wizyta>(`
    SELECT w.*, k.nazwa AS klient_nazwa
    FROM wizyty w LEFT JOIN klienci k ON k.id = w.klient_id
    WHERE ${warunki.join(' AND ')}
    ORDER BY
      CASE w.status WHEN 'nienaprawione' THEN 0 WHEN 'w_trakcie' THEN 1 ELSE 2 END,
      w.data_wizyty DESC, w.zrobione_o DESC
  `, ...params);
}

export async function otwarteUsterki(): Promise<Wizyta[]> {
  const db = await baza();
  return db.getAllAsync<Wizyta>(`
    SELECT w.*, k.nazwa AS klient_nazwa
    FROM wizyty w LEFT JOIN klienci k ON k.id = w.klient_id
    WHERE w.usuniete_o IS NULL AND w.status <> 'naprawione'
    ORDER BY w.data_wizyty DESC
  `);
}

export async function pobierzWizyte(id: string): Promise<Wizyta | null> {
  const db = await baza();
  return db.getFirstAsync<Wizyta>(`
    SELECT w.*, k.nazwa AS klient_nazwa, k.telefon AS klient_telefon
    FROM wizyty w LEFT JOIN klienci k ON k.id = w.klient_id
    WHERE w.id = ?
  `, id);
}

/* ====================================================================== */
/*  B3 - OSTRZEZENIA O DUPLIKATACH (dzialaja bez sieci)                   */
/* ====================================================================== */

const samCyfry = (t?: string | null) => (t ?? '').replace(/[^0-9]/g, '').slice(-9);
const doPorownania = (t?: string | null) => (t ?? '')
  .toLowerCase()
  .replace(/[ąĄ]/g, 'a').replace(/[ćĆ]/g, 'c').replace(/[ęĘ]/g, 'e')
  .replace(/[łŁ]/g, 'l').replace(/[ńŃ]/g, 'n').replace(/[óÓ]/g, 'o')
  .replace(/[śŚ]/g, 's').replace(/[źŹżŻ]/g, 'z')
  .replace(/[^a-z0-9]/g, '');

/** Czy ktos juz ma taki numer telefonu? Pyta o to formularz nowego klienta. */
export async function klienciZTymSamymTelefonem(telefon: string): Promise<KlientNaLiscie[]> {
  const numer = samCyfry(telefon);
  if (numer.length < 6) return [];
  const wszyscy = await listaKlientow();
  return wszyscy.filter((k) => samCyfry(k.telefon) === numer);
}

/**
 * Czy to auto ma juz otwarta wizyte z ostatnich 48 h?
 * Ostrzezenie przed zalozeniem drugiego zgloszenia tej samej usterki.
 */
export async function otwartaWizytaTegoAuta(auto: string): Promise<Wizyta | null> {
  const znormalizowane = doPorownania(auto);
  if (!znormalizowane) return null;
  const db = await baza();
  const granica = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const kandydaci = await db.getAllAsync<Wizyta>(`
    SELECT w.*, k.nazwa AS klient_nazwa
    FROM wizyty w LEFT JOIN klienci k ON k.id = w.klient_id
    WHERE w.usuniete_o IS NULL AND w.status <> 'naprawione'
      AND COALESCE(w.zrobione_o, w.data_wizyty) > ?
  `, granica);
  return kandydaci.find((w) => doPorownania(w.auto) === znormalizowane) ?? null;
}

/* ====================================================================== */
/*  ZAPIS                                                                 */
/* ====================================================================== */

/** Zostawia tylko pola, ktore faktycznie sie zmienily (B1). */
function tylkoZmienione(
  obecny: Record<string, unknown>,
  nowe: Record<string, unknown>,
): Record<string, unknown> {
  const wynik: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nowe)) {
    const stara = obecny[k] ?? null;
    const nowa = v ?? null;
    if (String(stara) !== String(nowa)) wynik[k] = nowa;
  }
  return wynik;
}

const PUSTE_NA_NULL = (t: unknown) => {
  const s = typeof t === 'string' ? t.trim() : t;
  return s === '' || s === undefined ? null : s;
};

/* ------------------------------- klienci ------------------------------- */

export type DaneKlienta = {
  nazwa: string;
  telefon?: string | null;
  email?: string | null;
  adres?: string | null;
  nip?: string | null;
  notatki?: string | null;
};

export async function utworzKlienta(dane: DaneKlienta): Promise<string> {
  const db = await baza();
  const id = nowyId();
  const czas = teraz();
  const pola = {
    nazwa: String(dane.nazwa).trim(),
    telefon: PUSTE_NA_NULL(dane.telefon),
    email: PUSTE_NA_NULL(dane.email),
    adres: PUSTE_NA_NULL(dane.adres),
    nip: PUSTE_NA_NULL(dane.nip),
    notatki: PUSTE_NA_NULL(dane.notatki),
  };

  await db.runAsync(
    'INSERT INTO klienci (id, nazwa, telefon, email, adres, nip, notatki, zrobione_o, oczekuje)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    id, pola.nazwa, pola.telefon as any, pola.email as any, pola.adres as any,
    pola.nip as any, pola.notatki as any, czas,
  );
  await dodajDoKolejki('klienci', id, 'wstaw', pola, czas);
  return id;
}

export async function zaktualizujKlienta(id: string, dane: Partial<DaneKlienta>): Promise<void> {
  const db = await baza();
  const obecny = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM klienci WHERE id = ?', id,
  );
  if (!obecny) return;

  const kandydaci: Record<string, unknown> = {};
  for (const pole of ['nazwa', 'telefon', 'email', 'adres', 'nip', 'notatki'] as const) {
    if (pole in dane) kandydaci[pole] = PUSTE_NA_NULL(dane[pole]);
  }
  const zmiany = tylkoZmienione(obecny, kandydaci);
  if (!Object.keys(zmiany).length) return;

  const czas = teraz();
  const set = Object.keys(zmiany).map((k) => `${k} = ?`).join(', ');
  await db.runAsync(
    `UPDATE klienci SET ${set}, zrobione_o = ?, oczekuje = 1 WHERE id = ?`,
    ...Object.values(zmiany) as any[], czas, id,
  );
  await dodajDoKolejki('klienci', id, 'zmien', zmiany, czas);
}

/** B2: kasowanie to znacznik. Fizycznie kasuje dopiero zadanie serwerowe. */
export async function usunKlienta(id: string): Promise<void> {
  const db = await baza();
  const czas = teraz();
  await db.runAsync('UPDATE klienci SET usuniete_o = ?, oczekuje = 1 WHERE id = ?', czas, id);
  await db.runAsync('UPDATE wizyty SET usuniete_o = ? WHERE klient_id = ? AND usuniete_o IS NULL',
    czas, id);
  await dodajDoKolejki('klienci', id, 'usun', {}, czas);
}

/** B3: scalenie kartotek zalozonych niezaleznie przez dwa telefony. */
export async function scalKlientow(zrodloId: string, celId: string): Promise<void> {
  const db = await baza();
  const czas = teraz();
  await db.runAsync('UPDATE wizyty SET klient_id = ? WHERE klient_id = ?', celId, zrodloId);
  await db.runAsync('UPDATE klienci SET usuniete_o = ?, oczekuje = 1 WHERE id = ?', czas, zrodloId);
  await dodajDoKolejki('klienci', zrodloId, 'scal', { docelowy: celId }, czas);
}

/* -------------------------------- wizyty ------------------------------- */

export type DaneWizyty = {
  klient_id: string;
  auto?: string | null;
  tytul: string;
  opis?: string | null;
  priorytet?: Priorytet;
};

/**
 * B5: numer roboczy z prefiksem warsztatu powstaje na telefonie, zeby
 * mechanik mial czym nazwac zlecenie od razu. Numer OFICJALNY nadaje serwer
 * przy synchronizacji - dzieki temu dwa warsztaty offline nie wygeneruja
 * tego samego "ZL/2026/0001".
 */
async function nowyNumerRoboczy(): Promise<string> {
  const prefiks = (await pobierzMeta('warsztat_prefiks')) ?? 'W';
  const licznik = Number((await pobierzMeta('licznik_roboczy')) ?? '0') + 1;
  await ustawMeta('licznik_roboczy', String(licznik));
  return `${prefiks}-${new Date().getFullYear()}-${String(licznik).padStart(4, '0')}`;
}

export async function utworzWizyte(dane: DaneWizyty): Promise<string> {
  const db = await baza();
  const id = nowyId();
  const czas = teraz();
  const data = czas.slice(0, 10);
  const numer = await nowyNumerRoboczy();

  const pola = {
    klient_id: dane.klient_id,
    auto: PUSTE_NA_NULL(dane.auto),
    tytul: String(dane.tytul).trim(),
    opis: PUSTE_NA_NULL(dane.opis),
    // Status ustala system - nowe zgloszenie zawsze startuje jako nienaprawione.
    status: 'nienaprawione' as Status,
    priorytet: (dane.priorytet ?? 'normalny') as Priorytet,
    data_wizyty: data,
    numer_roboczy: numer,
  };

  await db.runAsync(
    'INSERT INTO wizyty (id, klient_id, auto, tytul, opis, status, priorytet, data_wizyty,' +
    ' numer_roboczy, zrobione_o, oczekuje) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    id, pola.klient_id, pola.auto as any, pola.tytul, pola.opis as any,
    pola.status, pola.priorytet, pola.data_wizyty, pola.numer_roboczy, czas,
  );
  await dodajDoKolejki('wizyty', id, 'wstaw', pola, czas);
  return id;
}

export async function zaktualizujWizyte(
  id: string,
  dane: Partial<{
    auto: string | null; tytul: string; opis: string | null;
    status: Status; priorytet: Priorytet;
    data_wizyty: string; przebieg: number | null; koszt: number | null;
  }>,
): Promise<void> {
  const db = await baza();
  const obecna = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM wizyty WHERE id = ?', id,
  );
  if (!obecna) return;

  const kandydaci: Record<string, unknown> = {};
  for (const pole of ['auto', 'tytul', 'opis', 'status', 'priorytet',
    'data_wizyty', 'przebieg', 'koszt'] as const) {
    if (pole in dane) kandydaci[pole] = PUSTE_NA_NULL((dane as any)[pole]);
  }

  // Zamkniecie i ponowne otwarcie usterki pilnuje daty zamkniecia.
  if ('status' in kandydaci) {
    kandydaci.data_zamkniecia = kandydaci.status === 'naprawione'
      ? new Date().toISOString().slice(0, 10)
      : null;
  }

  const zmiany = tylkoZmienione(obecna, kandydaci);
  if (!Object.keys(zmiany).length) return;

  const czas = teraz();
  const set = Object.keys(zmiany).map((k) => `${k} = ?`).join(', ');
  await db.runAsync(
    `UPDATE wizyty SET ${set}, zrobione_o = ?, oczekuje = 1 WHERE id = ?`,
    ...Object.values(zmiany) as any[], czas, id,
  );
  await dodajDoKolejki('wizyty', id, 'zmien', zmiany, czas);
}

export function zmienStatusWizyty(id: string, status: Status) {
  return zaktualizujWizyte(id, { status });
}

export async function usunWizyte(id: string): Promise<void> {
  const db = await baza();
  const czas = teraz();
  await db.runAsync('UPDATE wizyty SET usuniete_o = ?, oczekuje = 1 WHERE id = ?', czas, id);
  await dodajDoKolejki('wizyty', id, 'usun', {}, czas);
}

/* ====================================================================== */
/*  A10 - dziennik dostepu                                                */
/*  Zapisujemy fakt otwarcia kartoteki. Nie zatrzyma to wyniesienia danych,*/
/*  ale pozwala odtworzyc, kto co ogladal.                                */
/* ====================================================================== */

export async function zapiszWDzienniku(
  akcja: 'otwarcie_klienta' | 'otwarcie_wizyty' | 'odblokowanie',
  klientId?: string | null,
  wizytaId?: string | null,
): Promise<void> {
  try {
    await dodajDoKolejki('dziennik_dostepu', nowyId(), 'wstaw', {
      akcja,
      klient_id: klientId ?? null,
      wizyta_id: wizytaId ?? null,
    });
  } catch {
    // Dziennik nie moze przeszkodzic w pracy - jesli sie nie zapisal, trudno.
  }
}

/* ====================================================================== */
/*  A3 / D10 - sprzatanie lokalnej bazy                                   */
/*  Ta sama regula co po stronie serwera: trzymamy okno historii plus      */
/*  wszystko otwarte. Dzieki temu baza na telefonie nie rosnie w nieskonczonosc,*/
/*  a razem ze zgubionym telefonem nie wyciekaja lata dokumentacji.        */
/* ====================================================================== */

export async function posprzatajPozaOknem(oknoDni: number): Promise<number> {
  const db = await baza();
  const granica = new Date(Date.now() - oknoDni * 86_400_000).toISOString().slice(0, 10);

  const wynik = await db.runAsync(`
    DELETE FROM wizyty
     WHERE status = 'naprawione'
       AND data_wizyty < ?
       AND oczekuje = 0
       AND id NOT IN (SELECT rekord_id FROM kolejka WHERE tabela = 'wizyty')
  `, granica);

  return wynik.changes ?? 0;
}
