/**
 * Metryki ukladu - caly interfejs jest projektowany pod WASKIE okno
 * o proporcjach okolo 9:16 (wysokie i waskie).
 *
 * Dwa zadania tego modulu:
 *
 *  1. KOLUMNA 9:16 - tresc nigdy nie rozlewa sie szerzej niz 9/16 wysokosci
 *     okna. W domyslnym rozmiarze okna nic to nie zmienia (okno i tak jest
 *     wezsze), ale po zmaksymalizowaniu na szerokim monitorze aplikacja dalej
 *     wyglada jak narzedzie pracy, a nie jak rozciagnieta strona internetowa.
 *
 *  2. SKALA - rozmiary sa liczone wzgledem okna referencyjnego 360 x 640 dp
 *     (dokladnie 9:16), wiec proporcje trzymaja sie tak samo na malym
 *     laptopie, jak i na duzym monitorze.
 */
import { Dimensions, Platform } from 'react-native';

/** Proporcje ekranu, pod ktore projektowany jest interfejs. */
export const PROPORCJA = 9 / 16; // 0.5625

/** Okno referencyjne: 360 x 640 dp = dokladnie 9:16. */
const BAZA_SZEROKOSC = 360;

export type Wymiary = { width: number; height: number };

/**
 * Wymiary okna odporne na zera.
 *
 * Na webie react-native-web startuje z wymiarami 0 x 0 i uzupelnia je dopiero
 * przy pierwszym zdarzeniu zmiany rozmiaru. Bez tego zabezpieczenia pierwsze
 * renderowanie widzialoby ekran o zerowej szerokosci i podejmowalo zle decyzje
 * o ukladzie. Na urzadzeniu Dimensions jest poprawne od razu.
 */
export function pewneWymiary(wymiary?: Wymiary): Wymiary {
  const w = wymiary ?? Dimensions.get('window');
  if (w.width > 0 && w.height > 0) return w;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const szerokosc = window.innerWidth || document?.documentElement?.clientWidth || 0;
    const wysokosc = window.innerHeight || document?.documentElement?.clientHeight || 0;
    if (szerokosc > 0 && wysokosc > 0) return { width: szerokosc, height: wysokosc };
  }
  return w;
}

const { width: szerokoscEkranu, height: wysokoscEkranu } = pewneWymiary();

/**
 * Szerokosc kolumny tresci dla podanego ekranu.
 * Nigdy nie przekracza 9/16 wysokosci - stad waski, wysoki ksztalt.
 */
export function szerokoscKolumny(szerokosc: number, wysokosc: number): number {
  return Math.min(szerokosc, Math.round(wysokosc * PROPORCJA));
}

/** Szerokosc kolumny dla rozmiaru okna z chwili uruchomienia. */
export const SZEROKOSC_KOLUMNY = szerokoscKolumny(szerokoscEkranu, wysokoscEkranu);

export const EKRAN = {
  szerokosc: szerokoscEkranu,
  wysokosc: wysokoscEkranu,
  /** Rzeczywiste proporcje okna, np. 0.52 dla domyslnego rozmiaru. */
  proporcja: szerokoscEkranu / wysokoscEkranu,
  /** Czy okno jest wezsze niz 9:16. */
  wyzszyNizReferencja: szerokoscEkranu / wysokoscEkranu < PROPORCJA,
};

const ograniczenie = (wartosc: number, min: number, max: number) =>
  Math.min(Math.max(wartosc, min), max);

/**
 * Wspolczynnik skali wzgledem okna referencyjnego.
 * Ograniczony, zeby na duzym monitorze interfejs nie urosl do absurdu.
 */
export const SKALA = ograniczenie(SZEROKOSC_KOLUMNY / BAZA_SZEROKOSC, 0.85, 1.3);

/** Skaluje rozmiar (odstep, czcionke, promien) do biezacego ekranu. */
export const s = (rozmiar: number): number => Math.round(rozmiar * SKALA * 10) / 10;

/**
 * Wysokosc jako procent wysokosci okna - dla elementow, ktore maja
 * zajmowac stala czesc wysokiego okna niezaleznie od jego rozmiaru.
 */
export function wys(procent: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.round(ograniczenie((wysokoscEkranu * procent) / 100, min, max));
}

/** Minimalny wygodny cel klikniecia (te same 44 dp co w wytycznych mobilnych). */
export const CEL_DOTYKU = Math.max(44, s(44));
