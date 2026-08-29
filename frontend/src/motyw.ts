/**
 * Wspolny motyw wizualny aplikacji.
 *
 * Kluczowa zasada projektu: usterki NIENAPRAWIONE musza rzucac sie w oczy.
 * Dlatego kolory i rozmiary sa zebrane w jednym miejscu i uzywane spojnie
 * przez kafelki historii wizyt.
 *
 * Wszystkie odstepy i czcionki przechodza przez skale z `uklad.ts`, wiec
 * proporcje interfejsu sa te same na kazdym telefonie o ukladzie ~9:16.
 */
import { Platform } from 'react-native';

import { s } from './uklad';

export const Kolory = {
  tlo: '#F3F5F8',
  powierzchnia: '#FFFFFF',
  powierzchniaStonowana: '#F7F8FA',

  tekst: '#111827',
  tekstDrugi: '#4B5563',
  tekstSlaby: '#8A93A2',
  tekstNaAkcencie: '#FFFFFF',

  obramowanie: '#E2E6EC',
  obramowanieMocne: '#CBD3DD',

  akcent: '#1D4ED8',
  akcentCiemny: '#1E3A8A',
  akcentTlo: '#EFF4FF',

  // status: nienaprawione
  pilne: '#DC2626',
  pilneTlo: '#FEF2F2',
  pilneObramowanie: '#FCA5A5',

  // status: w trakcie
  wTrakcie: '#B45309',
  wTrakcieTlo: '#FFFBEB',
  wTrakcieObramowanie: '#FCD34D',

  // status: naprawione
  ok: '#15803D',
  okTlo: '#F0FDF4',
  okObramowanie: '#BBF7D0',

  blad: '#B91C1C',
  bladTlo: '#FEF2F2',

  /* Oprawa ramki telefonu - widoczna tylko na szerokich ekranach
     (tablet, przegladarka). Nie nalezy do palety samej aplikacji. */
  tloOprawy: '#E7EBF1',
  obudowa: '#12161C',
} as const;

/** Odstepy pionowe i poziome - skalowane do wielkosci ekranu. */
export const Odstepy = {
  xs: s(4),
  s: s(8),
  m: s(12),
  l: s(16),
  xl: s(24),
  xxl: s(32),
} as const;

export const Zaokraglenia = {
  s: s(8),
  m: s(12),
  l: s(16),
  xl: s(22),
  pelne: 999,
} as const;

export const Typografia = {
  naglowek: { fontSize: s(26), fontWeight: '800' as const, color: Kolory.tekst },
  tytul: { fontSize: s(19), fontWeight: '700' as const, color: Kolory.tekst },
  podtytul: { fontSize: s(15), fontWeight: '600' as const, color: Kolory.tekstDrugi },
  tresc: { fontSize: s(15), fontWeight: '400' as const, color: Kolory.tekst },
  drobne: { fontSize: s(13), fontWeight: '400' as const, color: Kolory.tekstSlaby },
  etykieta: { fontSize: s(11), fontWeight: '700' as const, letterSpacing: 0.6 },
} as const;

/** Cien dla kart - mocniejszy dla elementow, ktore maja przyciagac wzrok. */
export function cien(poziom: 'brak' | 'lekki' | 'mocny' = 'lekki') {
  if (poziom === 'brak') return {};
  if (Platform.OS === 'android') {
    return { elevation: poziom === 'mocny' ? 6 : 2 };
  }
  return poziom === 'mocny'
    ? {
        shadowColor: '#0F172A',
        shadowOpacity: 0.16,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      }
    : {
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      };
}

/* --------------------------- Statusy wizyt --------------------------- */

export type Status = 'nienaprawione' | 'w_trakcie' | 'naprawione';

type OpisStatusu = {
  etykieta: string;
  kolor: string;
  tlo: string;
  obramowanie: string;
  otwarty: boolean;
};

export const OPIS_STATUSU: Record<Status, OpisStatusu> = {
  nienaprawione: {
    etykieta: 'NIENAPRAWIONE',
    kolor: Kolory.pilne,
    tlo: Kolory.pilneTlo,
    obramowanie: Kolory.pilneObramowanie,
    otwarty: true,
  },
  w_trakcie: {
    etykieta: 'W TRAKCIE',
    kolor: Kolory.wTrakcie,
    tlo: Kolory.wTrakcieTlo,
    obramowanie: Kolory.wTrakcieObramowanie,
    otwarty: true,
  },
  naprawione: {
    etykieta: 'NAPRAWIONE',
    kolor: Kolory.ok,
    tlo: Kolory.okTlo,
    obramowanie: Kolory.okObramowanie,
    otwarty: false,
  },
};

export function opisStatusu(status: string): OpisStatusu {
  return OPIS_STATUSU[status as Status] ?? OPIS_STATUSU.nienaprawione;
}

/** Czy pozycja ma byc pokazana jako DUZY kafelek (wszystko poza naprawionym). */
export function czyOtwarta(status: string): boolean {
  return status !== 'naprawione';
}

export const ETYKIETA_PRIORYTETU: Record<string, string> = {
  niski: 'niski',
  normalny: 'normalny',
  wysoki: 'WYSOKI',
};

/** Waga do sortowania listy usterek - im wyzsza, tym wyzej na liscie. */
const WAGA_PRIORYTETU: Record<string, number> = {
  wysoki: 2,
  normalny: 1,
  niski: 0,
};

export function wagaPriorytetu(priorytet?: string | null): number {
  return WAGA_PRIORYTETU[priorytet ?? ''] ?? WAGA_PRIORYTETU.normalny;
}
