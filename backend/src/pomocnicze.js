/** Wspolne pomocniki warstwy HTTP panelu administratora. */

/** Opakowuje handler async, aby bledy trafialy do middleware bledow. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Blad z kodem HTTP. */
export class BladHttp extends Error {
  constructor(status, komunikat, szczegoly) {
    super(komunikat);
    this.status = status;
    this.szczegoly = szczegoly;
  }
}

export const bledneZadanie = (komunikat, szczegoly) => new BladHttp(400, komunikat, szczegoly);
export const nieZnaleziono = (komunikat = 'Nie znaleziono zasobu') => new BladHttp(404, komunikat);
export const brakDostepu = (komunikat = 'Brak dostepu') => new BladHttp(401, komunikat);

/** Zwraca przyciety tekst albo null (puste stringi -> null). */
export function tekst(wartosc) {
  if (wartosc === undefined || wartosc === null) return null;
  const t = String(wartosc).trim();
  return t === '' ? null : t;
}

/** Wymagany tekst - rzuca 400, gdy pusty. */
export function tekstWymagany(wartosc, nazwa) {
  const t = tekst(wartosc);
  if (!t) throw bledneZadanie(`Pole "${nazwa}" jest wymagane`);
  return t;
}

const WZOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Waliduje identyfikator UUID (klucze glowne sa UUID - patrz B5). */
export function uuid(wartosc, nazwa = 'id') {
  const t = tekst(wartosc);
  if (!t || !WZOR_UUID.test(t)) throw bledneZadanie(`Nieprawidlowy parametr "${nazwa}"`);
  return t;
}

/** Liczba calkowita w zadanym zakresie albo null. */
export function liczbaZZakresu(wartosc, min, max, nazwa) {
  if (wartosc === undefined || wartosc === null || wartosc === '') return null;
  const n = Number(wartosc);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw bledneZadanie(`Pole "${nazwa}" musi byc liczba calkowita z zakresu ${min}-${max}`);
  }
  return n;
}

/**
 * A11 - czyszczenie danych osobowych przed zapisem do logu.
 * Do konsoli panelu nie moga trafiac nazwiska, telefony ani adresy klientow.
 */
const POLA_WRAZLIWE = new Set([
  'nazwa', 'telefon', 'email', 'adres', 'nip', 'notatki', 'opis', 'auto',
  'tytul', 'imie', 'haslo', 'token', 'sekret', 'apikey', 'authorization',
]);

export function bezDanychOsobowych(wartosc, glebokosc = 0) {
  if (glebokosc > 4 || wartosc === null || wartosc === undefined) return wartosc;
  if (Array.isArray(wartosc)) return wartosc.map((w) => bezDanychOsobowych(w, glebokosc + 1));
  if (typeof wartosc === 'object') {
    const wynik = {};
    for (const [k, v] of Object.entries(wartosc)) {
      wynik[k] = POLA_WRAZLIWE.has(k.toLowerCase())
        ? '[ukryte]'
        : bezDanychOsobowych(v, glebokosc + 1);
    }
    return wynik;
  }
  return wartosc;
}
