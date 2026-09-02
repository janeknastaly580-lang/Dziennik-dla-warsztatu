/** Formatowanie wartosci do wyswietlenia w interfejsie. */

const POLSKIE_ZNAKI: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'a', Ć: 'c', Ę: 'e', Ł: 'l', Ń: 'n', Ó: 'o', Ś: 's', Ź: 'z', Ż: 'z',
};

/** Male litery bez polskich znakow - wspolny poczatek obu porownan nizej. */
function bezOgonkow(tekst?: string | null): string {
  if (!tekst) return '';
  let wynik = '';
  for (const znak of String(tekst)) {
    wynik += POLSKIE_ZNAKI[znak] ?? znak.toLowerCase();
  }
  return wynik;
}

/**
 * Sprowadza tekst do postaci porownywalnej: male litery, bez polskich
 * znakow diakrytycznych i bez spacji/myslnikow. Dzieki temu "zielinska"
 * znajduje "Zielińska", a "kr12345" znajduje "KR 12345".
 */
export function doPorownania(tekst?: string | null): string {
  return bezOgonkow(tekst).replace(/[\s\-_.()]/g, '');
}

/**
 * Ostrzejsza odmiana: zostaja WYLACZNIE litery i cyfry. Uzywana tam, gdzie
 * dwa zapisy tej samej rzeczy maja wyjsc na rowne - przy szukaniu duplikatow
 * kartotek i tego samego auta ("VW/Passat" = "VW Passat").
 */
export function doPorownaniaScisle(tekst?: string | null): string {
  return bezOgonkow(tekst).replace(/[^a-z0-9]/g, '');
}

/** Ostatnie dziewiec cyfr numeru - polski numer bez prefiksu kraju. */
export function samCyfry(tekst?: string | null): string {
  return String(tekst ?? '').replace(/[^0-9]/g, '').slice(-9);
}

/** '2026-08-12' -> '12.08.2026' */
export function formatujDate(data?: string | null): string {
  if (!data) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : data;
}

/** 214000 -> '214 000 km' */
export function formatujPrzebieg(km?: number | null): string | null {
  if (km === null || km === undefined) return null;
  return `${km.toLocaleString('pl-PL').replace(/ /g, ' ')} km`;
}

/** 1234.5 -> '1234,50 zl' */
export function formatujKwote(kwota?: number | null): string | null {
  if (kwota === null || kwota === undefined) return null;
  return `${kwota.toFixed(2).replace('.', ',')} zl`;
}

/**
 * Opis auta do pokazania w jednej linii.
 * Pole `auto` jest swobodnym tekstem i moze byc wielolinijkowe - tutaj
 * skladamy je w jedna linie, zeby nie rozpychalo kafelka.
 */
export function opisAuta(auto?: string | null, gdyBrak = 'Auto nieokreslone'): string {
  const t = (auto ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? gdyBrak : t;
}

/** Krotka etykieta na zakladke auta (przycieta, jesli opis jest dlugi). */
export function etykietaAuta(auto?: string | null, maks = 26): string {
  const t = opisAuta(auto, 'Bez auta');
  return t.length > maks ? t.slice(0, maks - 1).trimEnd() + '…' : t;
}

/**
 * Sklejona lista aut z widoku listy klientow.
 * Baza zwraca je rozdzielone samym przecinkiem - dokladamy odstep,
 * zeby dalo sie to czytac w jednej linii.
 */
export function listaAut(auta?: string | null): string {
  return opisAuta(auta, '').replace(/\s*,\s*/g, ', ');
}

/**
 * Polska odmiana liczebnika: odmiana(1, 'auto', 'auta', 'aut') -> 'auto'.
 * Zwraca sama forme rzeczownika, bez liczby.
 */
export function odmiana(n: number, poj: string, kilka: string, wiele: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return poj;
  const ost = abs % 10;
  const dwieOst = abs % 100;
  if (ost >= 2 && ost <= 4 && !(dwieOst >= 12 && dwieOst <= 14)) return kilka;
  return wiele;
}
