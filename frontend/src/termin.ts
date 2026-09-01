/**
 * Termin wizyty - dzien i godziny, w ktorych auto stoi w warsztacie.
 *
 * Godziny trzymamy jako tekst 'HH:MM', dokladnie tak jak date trzymamy jako
 * 'YYYY-MM-DD': sortuje sie samo, nie ma stref czasowych i nie przesuwa sie
 * po zmianie ustawien telefonu. Serwer ma te kolumny jako `time`, wiec
 * z synchronizacji wracaja z sekundami ('08:00:00') - `naMinuty` to znosi.
 *
 * Caly ruch po siatce kalendarza chodzi w minutach od polnocy; tekst
 * powstaje dopiero przy zapisie.
 */

/** Do czego przyciaga sie przeciaganie na siatce. */
export const KROK = 15;
/** Krotsza wizyta nie ma sensu i znika z siatki. */
export const MIN_DLUGOSC = 15;
export const DOMYSLNA_DLUGOSC = 60;
export const DZIEN = 24 * 60;

export type Termin = {
  /** 'YYYY-MM-DD' */
  data: string;
  /** 'HH:MM' */
  godzinaOd: string;
  /** 'HH:MM' */
  godzinaDo: string;
};

const dwie = (n: number) => String(n).padStart(2, '0');

/** '08:30' albo '08:30:00' -> 510 */
export function naMinuty(godzina?: string | null): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(godzina ?? '').trim());
  if (!m) return 0;
  return Math.max(0, Math.min(DZIEN, Number(m[1]) * 60 + Number(m[2])));
}

/** 510 -> '08:30'. Liczba spoza skali dnia (albo NaN) nie ma prawa
 *  wyjsc z tej funkcji jako godzina - zapisalaby sie do bazy. */
export function naGodzine(minuty: number): string {
  if (!Number.isFinite(minuty)) return '00:00';
  const m = Math.max(0, Math.min(DZIEN, Math.round(minuty)));
  return `${dwie(Math.floor(m / 60))}:${dwie(m % 60)}`;
}

export const doKroku = (minuty: number): number => Math.round(minuty / KROK) * KROK;

export const dlugosc = (t: Termin): number => naMinuty(t.godzinaDo) - naMinuty(t.godzinaOd);

/* ----------------------------- dni ----------------------------------- */

/** Data z tekstu w czasie LOKALNYM - `new Date('2026-09-02')` byloby UTC. */
function naDate(data: string): Date {
  const [rok, miesiac, dzien] = String(data).slice(0, 10).split('-').map(Number);
  return new Date(rok || 1970, (miesiac || 1) - 1, dzien || 1);
}

export const naTekstDaty = (d: Date): string =>
  `${d.getFullYear()}-${dwie(d.getMonth() + 1)}-${dwie(d.getDate())}`;

export const dzisiaj = (): string => naTekstDaty(new Date());

export function przesunDzien(data: string, oDni: number): string {
  const d = naDate(data);
  d.setDate(d.getDate() + oDni);
  return naTekstDaty(d);
}

/* --------------------------- domyslny termin -------------------------- */

/** Dzis, od najblizszego kwadransa, godzina roboty. */
export function domyslnyTermin(data: string = dzisiaj()): Termin {
  const teraz = new Date();
  const najblizszy = Math.ceil((teraz.getHours() * 60 + teraz.getMinutes()) / KROK) * KROK;
  const od = Math.max(0, Math.min(najblizszy, DZIEN - DOMYSLNA_DLUGOSC));
  return { data, godzinaOd: naGodzine(od), godzinaDo: naGodzine(od + DOMYSLNA_DLUGOSC) };
}

/** Termin zapisany przy wizycie - albo null, gdy godzin nie ustawiono. */
export function terminWizyty(wizyta: {
  data_wizyty?: string | null;
  godzina_od?: string | null;
  godzina_do?: string | null;
}): Termin | null {
  if (!wizyta.godzina_od || !wizyta.godzina_do) return null;
  return {
    data: String(wizyta.data_wizyty ?? '').slice(0, 10),
    godzinaOd: naGodzine(naMinuty(wizyta.godzina_od)),
    godzinaDo: naGodzine(naMinuty(wizyta.godzina_do)),
  };
}

export const takiSam = (a: Termin, b: Termin): boolean =>
  a.data === b.data && a.godzinaOd === b.godzinaOd && a.godzinaDo === b.godzinaDo;

/* ------------------------------ napisy -------------------------------- */

const DNI = ['nd', 'pon', 'wt', 'sr', 'czw', 'pt', 'sob'];
const MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'wrzesnia', 'pazdziernika', 'listopada', 'grudnia'];

/** '2026-09-02' -> 'sr 2 wrzesnia' */
export function etykietaDnia(data: string): string {
  const d = naDate(data);
  return `${DNI[d.getDay()]} ${d.getDate()} ${MIESIACE[d.getMonth()]}`;
}

/** '2026-09-02' -> 'sr 2.09' */
export function etykietaKrotka(data: string): string {
  const d = naDate(data);
  return `${DNI[d.getDay()]} ${d.getDate()}.${dwie(d.getMonth() + 1)}`;
}

/** 'Dzis' / 'Jutro' / 'Wczoraj' - albo nic, gdy dzien jest dalej. */
export function wzgledemDzis(data: string): string | null {
  const dzis = dzisiaj();
  if (data === dzis) return 'Dzis';
  if (data === przesunDzien(dzis, 1)) return 'Jutro';
  if (data === przesunDzien(dzis, -1)) return 'Wczoraj';
  return null;
}

/** 90 -> '1 godz. 30 min' */
export function formatujCzasTrwania(minuty: number): string {
  const godziny = Math.floor(Math.max(0, minuty) / 60);
  const reszta = Math.max(0, minuty) % 60;
  if (godziny && reszta) return `${godziny} godz. ${reszta} min`;
  if (godziny) return `${godziny} godz.`;
  return `${reszta} min`;
}

/** '08:00–10:00' */
export const formatujGodziny = (t: Termin): string => `${t.godzinaOd}–${t.godzinaDo}`;

/** '08:00–10:00' dla wizyty; null, gdy godziny nie zostaly ustawione. */
export function godzinyWizyty(wizyta: {
  data_wizyty?: string | null;
  godzina_od?: string | null;
  godzina_do?: string | null;
}): string | null {
  const t = terminWizyty(wizyta);
  return t ? formatujGodziny(t) : null;
}

/** 'sr 2.09 · 08:00–10:00 · 2 godz.' */
export function formatujTermin(t: Termin | null): string {
  if (!t) return '-';
  return `${etykietaKrotka(t.data)} · ${formatujGodziny(t)} · ${formatujCzasTrwania(dlugosc(t))}`;
}
