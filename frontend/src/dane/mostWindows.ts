/**
 * Most do Windowsa.
 *
 * Ekrany aplikacji sa zwyklym kodem React Native Web i same z siebie nie
 * potrafia ani zaszyfrowac bazy, ani schowac klucza. Robi to za nie proces
 * glowny programu (`windows/glowny.js`), a tu jest jego jedyne wejscie:
 * obiekt `window.warsztat` wystawiony przez `windows/mostek.js`.
 *
 * Gdy mostu nie ma, znaczy to, ze aplikacja chodzi w zwyklej przegladarce
 * (`npm run web`) - czyli w trybie podgladu interfejsu, bez szyfrowania.
 * Aplikacja mowi o tym wprost paskiem na gorze ekranu; cicha degradacja
 * zabezpieczen bylaby gorsza niz ich brak.
 */

/** Podzbior `expo-sqlite`, ktorego uzywa aplikacja - i tyle musi dac most. */
export type Baza = {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...parametry: any[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...parametry: any[]): Promise<T[]>;
  runAsync(sql: string, ...parametry: any[]): Promise<{ changes: number }>;
  withTransactionAsync(zadanie: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
};

type ApiWindows = {
  system: {
    opis(): Promise<{ nazwa: string; uzytkownik: string; wersja: string }>;
  };
  klucz: {
    czytaj(nazwa: string): Promise<string | null>;
    zapisz(nazwa: string, wartosc: string): Promise<boolean>;
    skasuj(nazwa: string): Promise<boolean>;
  };
  baza: {
    otworz(klucz: string): Promise<boolean>;
    polecenia(sql: string): Promise<boolean>;
    pobierz(sql: string, parametry: unknown[]): Promise<unknown>;
    wszystkie(sql: string, parametry: unknown[]): Promise<unknown[]>;
    wykonaj(sql: string, parametry: unknown[]): Promise<{ changes: number }>;
    zamknij(): Promise<boolean>;
    skasuj(): Promise<boolean>;
  };
};

function znajdzMost(): ApiWindows | null {
  const okno = globalThis as unknown as { warsztat?: ApiWindows };
  return okno?.warsztat ?? null;
}

export const MOST = znajdzMost();

/** true = pelna wersja programu na Windowsie (szyfrowana baza, klucz w DPAPI). */
export const NA_WINDOWS = MOST !== null;

export function most(): ApiWindows {
  if (!MOST) throw new Error('Ta funkcja dziala tylko w programie na Windows.');
  return MOST;
}

/**
 * Baza po stronie Windowsa. Kazde zapytanie idzie do procesu glownego, ktory
 * trzyma otwarty plik SQLCipher - w ekranach nie ma ani bazy, ani klucza.
 */
export function bazaWindows(): Baza {
  const api = most().baza;

  return {
    async execAsync(sql: string) {
      await api.polecenia(sql);
    },
    async getFirstAsync<T>(sql: string, ...parametry: any[]) {
      return (await api.pobierz(sql, parametry)) as T | null;
    },
    async getAllAsync<T>(sql: string, ...parametry: any[]) {
      return (await api.wszystkie(sql, parametry)) as T[];
    },
    async runAsync(sql: string, ...parametry: any[]) {
      return api.wykonaj(sql, parametry);
    },
    /**
     * Transakcja rozpisana na trzy polecenia. Zapytania z ekranow ida jedno
     * po drugim (kazde jest czekane), wiec nic obcego nie wejdzie w srodek.
     */
    async withTransactionAsync(zadanie: () => Promise<void>) {
      await api.polecenia('BEGIN');
      try {
        await zadanie();
        await api.polecenia('COMMIT');
      } catch (blad) {
        await api.polecenia('ROLLBACK').catch(() => undefined);
        throw blad;
      }
    },
    async closeAsync() {
      await api.zamknij();
    },
  };
}
