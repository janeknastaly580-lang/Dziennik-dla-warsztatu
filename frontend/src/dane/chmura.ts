/**
 * Rozmowa z chmura (Edge Functions Supabase).
 *
 * Dwa rodzaje bledow, ktore trzeba rozroznic - od tego zalezy, czy aplikacja
 * ma ponowic, czy skasowac dane:
 *
 *   BladSieci      - brak zasiegu, timeout, 5xx.  PONOW PROSNIEJ. Nigdy nie
 *                    kasuj z tego powodu ani sesji, ani kolejki (D1, B8).
 *   BladDostepu    - serwer mowi wprost: token nieznany, dostep zablokowany
 *                    albo polecenie wyczyszczenia. Wtedy i tylko wtedy
 *                    aplikacja czysci lokalna baze (A4, A6).
 */
import { ADRES_CHMURY, KLUCZ_PUBLICZNY, WERSJA_APLIKACJI, WERSJA_SCHEMATU } from './konfiguracja';

export class BladSieci extends Error {
  constructor(komunikat: string) {
    super(komunikat);
    this.name = 'BladSieci';
  }
}

export type PowodOdciecia = 'NIEZNANY_TOKEN' | 'ZABLOKOWANE' | 'WYCZYSC' | 'NIEPRZYPISANE';

export class BladDostepu extends Error {
  kod: PowodOdciecia;
  powod?: string;

  constructor(kod: PowodOdciecia, powod?: string) {
    super(powod ?? kod);
    this.name = 'BladDostepu';
    this.kod = kod;
    this.powod = powod;
  }
}

const LIMIT_CZASU_MS = 25_000;

async function wywolaj(
  funkcja: 'parowanie' | 'sync' | 'admin',
  cialo: Record<string, unknown>,
  token?: string | null,
): Promise<any> {
  if (!ADRES_CHMURY) {
    throw new BladSieci('Aplikacja nie ma ustawionego adresu serwera.');
  }

  const kontroler = new AbortController();
  const czasomierz = setTimeout(() => kontroler.abort(), LIMIT_CZASU_MS);

  const naglowki: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    apikey: KLUCZ_PUBLICZNY,
    Authorization: `Bearer ${KLUCZ_PUBLICZNY}`,
  };
  if (token) naglowki['x-token-urzadzenia'] = token;

  let odpowiedz: Response;
  try {
    odpowiedz = await fetch(`${ADRES_CHMURY}/functions/v1/${funkcja}`, {
      method: 'POST',
      headers: naglowki,
      body: JSON.stringify({
        ...cialo,
        wersja_schematu: WERSJA_SCHEMATU,
        wersja_aplikacji: WERSJA_APLIKACJI,
      }),
      signal: kontroler.signal,
    });
  } catch {
    throw new BladSieci('Brak polaczenia z serwerem.');
  } finally {
    clearTimeout(czasomierz);
  }

  const dane = await odpowiedz.json().catch(() => null);

  if (odpowiedz.status === 401 || odpowiedz.status === 403) {
    const kod = (dane?.kod ?? 'NIEZNANY_TOKEN') as PowodOdciecia;
    if (kod === 'NIEZNANY_TOKEN' || kod === 'ZABLOKOWANE'
        || kod === 'WYCZYSC' || kod === 'NIEPRZYPISANE') {
      throw new BladDostepu(kod, dane?.powod);
    }
    throw new BladSieci(dane?.kod ?? `Odmowa dostepu (${odpowiedz.status}).`);
  }

  // Wszystko inne, co nie jest 2xx, traktujemy jako awarie przejsciowa.
  // Nigdy nie zamieniamy jej na "wyrzuc dane" (B8).
  if (!odpowiedz.ok) {
    throw new BladSieci(dane?.kod ?? `Serwer odpowiedzial bledem ${odpowiedz.status}.`);
  }

  return dane;
}

/* ------------------------------ parowanie ------------------------------ */

export type OdpowiedzZgloszenia = {
  id: string;
  kod: string;
  sekret: string;
  wygasa_o: string;
};

/**
 * Prosba o dostep. `imie` wpisuje SAM MECHANIK na swoim telefonie - z tego
 * powstanie potem jego konto, wiec pisownie nazwiska ustala osoba, ktora zna
 * ja najlepiej. Samo imie niczego nie autoryzuje: dostep i tak przyznaje
 * administrator, a token odbiera wylacznie ten telefon, ktory ma sekret.
 */
export function zglosUrzadzenie(dane: {
  platforma: string; nazwa_urzadzenia: string; imie: string;
}) {
  return wywolaj('parowanie', { akcja: 'zglos', ...dane }) as Promise<OdpowiedzZgloszenia>;
}

export type Rola = 'mechanik' | 'kierownik' | 'administrator';

export type OdpowiedzSprawdzenia =
  | { status: 'oczekuje' | 'wygasl' }
  | {
      status: 'przyznany';
      token: string;
      urzadzenie_id: string;
      mechanik: { id: string; imie: string; rola: Rola };
      warsztat: {
        id: string; nazwa: string; prefiks: string;
        okno_dni: number; wygasniecie_offline_dni: number;
      };
    };

/**
 * Druga droga wejscia: kod zaproszenia od dostawcy uslugi. Zaklada warsztat
 * i jego pierwszego administratora. Bez tego nikt nie mialby jak zaczac -
 * dostawca nie hostuje zadnego panelu, wiec kod jest jedynym punktem startu.
 */
export function aktywujZaproszenie(id: string, sekret: string, kodZaproszenia: string) {
  return wywolaj('parowanie', {
    akcja: 'aktywuj_zaproszenie', id, sekret, kod_zaproszenia: kodZaproszenia,
  }) as Promise<{ ok: boolean; blad?: string }>;
}

export function sprawdzZgode(id: string, sekret: string) {
  return wywolaj('parowanie', { akcja: 'sprawdz', id, sekret }) as Promise<OdpowiedzSprawdzenia>;
}

export function zglosUstawienieHasla(token: string) {
  return wywolaj('parowanie', { akcja: 'haslo_ustawione' }, token);
}

/* ------------------------------ synchronizacja ------------------------- */

export type Kursor = { ts: string; id: string } | null;

export type OdpowiedzPull = {
  ok: boolean;
  kod?: string;
  serwer_czas: string;
  okno_od?: string;
  klienci?: any[];
  wizyty?: any[];
  kursory?: { klienci: Kursor; wizyty: Kursor };
  wiecej?: boolean;
  wymaga_aktualizacji?: boolean;
  mechanik: { id: string; imie: string; rola: Rola };
  warsztat: { id: string; nazwa: string; prefiks: string; okno_dni: number };
  polecenia: { reset_hasla: boolean };
  wygasniecie_offline_dni: number;
};

export function pobierzZmiany(
  token: string,
  kursory: { klienci: Kursor; wizyty: Kursor },
  limit: number,
) {
  return wywolaj('sync', { akcja: 'pull', kursory, limit }, token) as Promise<OdpowiedzPull>;
}

export type ZmianaDoWyslania = {
  id_lokalne: string;
  tabela: string;
  rekord_id: string;
  operacja: 'wstaw' | 'zmien' | 'usun' | 'scal';
  pola: Record<string, unknown>;
  zrobione_o: string;
};

export type WynikZmiany = {
  id_lokalne: string;
  /**
   * `odmowa` to swiadoma decyzja serwera (np. karencja usuwania wizyty),
   * a nie awaria. Rozni sie tym od `kwarantanna`, gdzie zapisu nie dalo sie
   * zastosowac z powodu, ktorego nikt nie przewidzial.
   */
  status: 'ok' | 'kwarantanna' | 'scalone' | 'odmowa';
  id?: string;
  numer_oficjalny?: string;
  mozliwy_duplikat?: string;
  blad?: string;
  powod?: string;
  wolno_od?: string;
};

export function wyslijZmiany(token: string, zmiany: ZmianaDoWyslania[]) {
  return wywolaj('sync', { akcja: 'push', zmiany }, token) as Promise<{
    ok: boolean; wyniki: WynikZmiany[]; polecenia: { reset_hasla: boolean };
  }>;
}

export function sprawdzStan(token: string) {
  return wywolaj('sync', { akcja: 'stan' }, token) as Promise<OdpowiedzPull>;
}

/* ====================================================================== */
/*  ADMINISTRATOR                                                         */
/*                                                                        */
/*  Administrator to mechanik z rola "administrator" - nie ma zadnego     */
/*  osobnego panelu ani serwera. Moze dokladnie dwie rzeczy wiecej:       */
/*  przyznac dostep telefonowi i odebrac dostep. Uprawnienia sprawdza     */
/*  funkcja brzegowa ORAZ, niezaleznie od niej, kazda funkcja w bazie.    */
/* ====================================================================== */

export type UrzadzenieAdmina = {
  id: string;
  nazwa: string | null;
  platforma: string | null;
  wersja: string | null;
  ostatnia_sync_o: string | null;
  zablokowane_o: string | null;
  czeka_na_haslo: boolean;
};

export type MechanikAdmina = {
  id: string;
  imie: string;
  rola: Rola;
  zablokowany_o: string | null;
  powod_blokady: string | null;
  to_ja: boolean;
  urzadzenia: UrzadzenieAdmina[];
};

export type OczekujaceUrzadzenie = {
  kod: string;
  /** Imie i nazwisko wpisane przez mechanika na jego telefonie. */
  imie: string | null;
  nazwa: string | null;
  platforma: string | null;
  wersja: string | null;
  zgloszone_o: string;
  wygasa_o: string;
};

export type DaneAdmina = {
  ok: boolean;
  warsztat: { id: string; nazwa: string; prefiks: string };
  mechanicy: MechanikAdmina[];
  oczekujace: OczekujaceUrzadzenie[];
};

/** Wynik akcji administratora. `ok:false` to odmowa merytoryczna, nie awaria. */
export type WynikAkcji = { ok: boolean; blad?: string };

export function daneAdmina(token: string) {
  return wywolaj('admin', { akcja: 'dane' }, token) as Promise<DaneAdmina>;
}

export function dodajMechanika(token: string, imie: string, rola: Rola = 'mechanik') {
  return wywolaj('admin', { akcja: 'dodaj_mechanika', imie, rola }, token) as Promise<WynikAkcji>;
}

/**
 * Zatwierdzenie telefonu jednym klikiem.
 *
 * Administrator nie wpisuje niczego - podaje tylko kod wiersza, ktory dotknal.
 * Konto mechanika zaklada sie po stronie serwera, z imienia podanego przez
 * samego mechanika przy zgloszeniu.
 */
export function zatwierdzUrzadzenie(token: string, kod: string) {
  return wywolaj('admin', { akcja: 'zatwierdz', kod }, token) as Promise<
    WynikAkcji & { imie?: string; nowe_konto?: boolean }
  >;
}

/**
 * Starsza droga: kod + recznie wskazane konto mechanika. Aplikacja jej juz
 * nie uzywa (zostala zastapiona przez `zatwierdzUrzadzenie`), ale serwer
 * nadal ja obsluguje - na telefonach moze jeszcze chodzic poprzednia wersja.
 */
export function przyznajDostep(token: string, kod: string, mechanikId: string) {
  return wywolaj('admin', {
    akcja: 'przyznaj', kod, mechanik_id: mechanikId,
  }, token) as Promise<WynikAkcji>;
}

export function zablokujMechanika(token: string, mechanikId: string, powod?: string) {
  return wywolaj('admin', {
    akcja: 'zablokuj_mechanika', mechanik_id: mechanikId, powod,
  }, token) as Promise<WynikAkcji>;
}

export function odblokujMechanika(token: string, mechanikId: string) {
  return wywolaj('admin', {
    akcja: 'odblokuj_mechanika', mechanik_id: mechanikId,
  }, token) as Promise<WynikAkcji>;
}

export function akcjaNaUrzadzeniu(
  token: string,
  urzadzenieId: string,
  co: 'zablokuj' | 'odblokuj' | 'wyrejestruj' | 'reset_hasla',
) {
  return wywolaj('admin', {
    akcja: 'urzadzenie', urzadzenie_id: urzadzenieId, co,
  }, token) as Promise<WynikAkcji>;
}
