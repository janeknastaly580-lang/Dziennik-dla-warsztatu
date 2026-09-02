/**
 * Metryki ukladu - interfejs programu na komputer.
 *
 * Ekrany zajmuja CALE okno, ale nie kazda tresc ma sie po nim rozlewac.
 * Trzy szerokosci zalatwiaja caly uklad:
 *
 *   SZEROKOSC_TRESCI       listy i siatki kafelkow. Powyzej tej granicy
 *                          tresc staje na srodku, zamiast ciagnac sie przez
 *                          caly monitor.
 *   SZEROKOSC_CZYTANIA     ekrany, ktore sie CZYTA (zgloszenie, ustawienia,
 *                          zarzadzanie dostepem) - krotszy wiersz czyta sie
 *                          latwiej niz metrowy.
 *   SZEROKOSC_FORMULARZA   formularze. Pole tekstowe szerokie na cale okno
 *                          wyglada jak blad, a nie jak pole.
 *
 * Kalendarz jest wyjatkiem i bierze cale okno - cztery dni obok siebie
 * potrzebuja miejsca.
 *
 * SKALA trzyma proporcje czcionek, odstepow i zaokraglen. Liczy sie ja raz,
 * wzgledem okna referencyjnego 360 dp, i ogranicza z obu stron, zeby na
 * czterech monitorach obok siebie interfejs nie urosl do absurdu.
 */
import { Dimensions, Platform } from 'react-native';

/** Okno referencyjne dla skali: 360 dp szerokosci. */
const BAZA_SZEROKOSC = 360;

/** Najwezsze okno, przy ktorym uklad jeszcze ma sens. */
export const MINIMALNA_SZEROKOSC = 720;

export const SZEROKOSC_TRESCI = 1320;
export const SZEROKOSC_CZYTANIA = 940;
export const SZEROKOSC_FORMULARZA = 760;

/** Najwezszy kafelek na siatce - ponizej tego lepiej dac jedna kolumne mniej. */
const MINIMALNY_KAFELEK = 380;

export type Wymiary = { width: number; height: number };

/**
 * Wymiary okna odporne na zera.
 *
 * Na webie react-native-web startuje z wymiarami 0 x 0 i uzupelnia je dopiero
 * przy pierwszym zdarzeniu zmiany rozmiaru. Bez tego zabezpieczenia pierwsze
 * renderowanie widzialoby okno o zerowej szerokosci i podejmowalo zle decyzje
 * o ukladzie.
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

export const EKRAN = {
  szerokosc: szerokoscEkranu,
  wysokosc: wysokoscEkranu,
};

const ograniczenie = (wartosc: number, min: number, max: number) =>
  Math.min(Math.max(wartosc, min), max);

/**
 * Ile kolumn kafelkow zmiesci sie w podanej szerokosci. Kafelek klienta albo
 * usterki ponizej ~380 dp robi sie nieczytelny, wiec wolimy mniej kolumn
 * i szersze kafelki niz odwrotnie.
 */
export function kolumnyKafelkow(szerokosc: number, maks = 3): number {
  const dostepna = Math.min(szerokosc, SZEROKOSC_TRESCI);
  return ograniczenie(Math.floor(dostepna / MINIMALNY_KAFELEK), 1, maks);
}

/**
 * Dopelnia liste pustymi miejscami do pelnego wiersza siatki. Bez tego
 * dwa kafelki w ostatnim wierszu rozciagalyby sie na pol okna kazdy,
 * a reszta listy zostawala waska - siatka wygladalaby na rozjechana.
 */
export function dopelnijWiersz<T>(lista: T[], kolumny: number): (T | null)[] {
  if (kolumny < 2 || lista.length === 0) return lista;
  const brakuje = (kolumny - (lista.length % kolumny)) % kolumny;
  return brakuje ? [...lista, ...Array<null>(brakuje).fill(null)] : lista;
}

/** Wspolczynnik skali czcionek i odstepow wzgledem okna referencyjnego. */
export const SKALA = ograniczenie(szerokoscEkranu / BAZA_SZEROKOSC, 0.85, 1.3);

/** Skaluje rozmiar (odstep, czcionke, promien) do biezacego okna. */
export const s = (rozmiar: number): number => Math.round(rozmiar * SKALA * 10) / 10;

/**
 * Wysokosc jako procent wysokosci okna - dla elementow, ktore maja zajmowac
 * stala czesc okna niezaleznie od jego rozmiaru.
 */
export function wys(procent: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.round(ograniczenie((wysokoscEkranu * procent) / 100, min, max));
}

/** Minimalny wygodny cel klikniecia. */
export const CEL_DOTYKU = Math.max(44, s(44));
