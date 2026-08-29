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
  funkcja: 'parowanie' | 'sync',
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

export function zglosUrzadzenie(dane: { platforma: string; nazwa_urzadzenia: string }) {
  return wywolaj('parowanie', { akcja: 'zglos', ...dane }) as Promise<OdpowiedzZgloszenia>;
}

export type OdpowiedzSprawdzenia =
  | { status: 'oczekuje' | 'wygasl' }
  | {
      status: 'przyznany';
      token: string;
      urzadzenie_id: string;
      mechanik: { id: string; imie: string };
      warsztat: {
        id: string; nazwa: string; prefiks: string;
        okno_dni: number; wygasniecie_offline_dni: number;
      };
    };

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
  mechanik: { id: string; imie: string };
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
  status: 'ok' | 'kwarantanna' | 'scalone';
  id?: string;
  numer_oficjalny?: string;
  mozliwy_duplikat?: string;
  blad?: string;
};

export function wyslijZmiany(token: string, zmiany: ZmianaDoWyslania[]) {
  return wywolaj('sync', { akcja: 'push', zmiany }, token) as Promise<{
    ok: boolean; wyniki: WynikZmiany[]; polecenia: { reset_hasla: boolean };
  }>;
}

export function sprawdzStan(token: string) {
  return wywolaj('sync', { akcja: 'stan' }, token) as Promise<OdpowiedzPull>;
}
