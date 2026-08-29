/**
 * Silnik synchronizacji.
 *
 * Reguly, ktore ten plik egzekwuje:
 *
 *  D1  Nieudana synchronizacja NIGDY nie czysci sesji ani kolejki. Brak sieci
 *      to zwykly stan pracy w warsztacie, a nie powod do wylogowania.
 *  B8  Pozycja kolejki znika dopiero, gdy serwer POTWIERDZI jej przyjecie -
 *      takze wtedy, gdy odlozyl ja do kwarantanny. Blad sieci zostawia ja
 *      na miejscu. Dzieki temu kolejka zawsze sie oprozni i nigdy nie
 *      zatrzyma sie na jednym zepsutym rekordzie.
 *  D7  Wysylka idzie paczkami, jedna naraz, z minimalna przerwa miedzy
 *      automatycznymi cyklami. Dziesiec telefonow wracajacych jednoczesnie
 *      do sieci nie zaleje lacza.
 *  A3  Po pobraniu danych lokalna baza jest przycinana do tego samego okna,
 *      ktore stosuje serwer.
 *  A4  Telefon, ktory nie polaczyl sie z serwerem dluzej niz okno offline
 *      warsztatu, kasuje swoja lokalna baze. Skradziony telefon juz nigdy
 *      sie nie polaczy, wiec sam sie wyczysci.
 *  A6  Odpowiedz "zablokowane" albo "wyczysc" konczy sie natychmiastowym
 *      skasowaniem danych z telefonu.
 */
import {
  BladDostepu, BladSieci, PowodOdciecia, ZmianaDoWyslania,
  pobierzZmiany, wyslijZmiany,
} from './chmura';
import { baza, pobierzMeta, pobierzMetaJson, ustawMeta, ustawMetaJson } from './baza';
import {
  liczbaWKolejce, najstarszaPozycja, pobierzPaczke, usunZKolejki, zanotujNieudanaProbe,
} from './kolejka';
import { pobierzToken, wyczyscWszystko } from './sesja';
import { posprzatajPozaOknem } from './repozytorium';
import {
  DOMYSLNE_OKNO_DNI, DOMYSLNE_WYGASNIECIE_OFFLINE_DNI, MIN_PRZERWA_SYNC_MS,
  WIERSZY_NA_STRONE, ZMIAN_NA_PACZKE,
} from './konfiguracja';

export type StanSynchronizacji = {
  trwa: boolean;
  /** Kiedy ostatnio UDALO SIE polaczyc z serwerem (D4 - wiek danych). */
  ostatniaUdana: string | null;
  /** D5 - ile zmian czeka na wyslanie. */
  wKolejce: number;
  /** D5 - najstarsza pozycja; jesli czeka dobe, cos jest nie tak. */
  najstarszaCzeka: string | null;
  blad: string | null;
  /** A6 - dostep odebrany; dane zostaly juz z telefonu skasowane. */
  odciecie: { kod: PowodOdciecia; powod?: string } | null;
  /** Administrator kazal ustawic nowe haslo. */
  resetHasla: boolean;
  /** B10 - aplikacja jest za stara, zeby pobierac dane. */
  wymagaAktualizacji: boolean;
};

let stan: StanSynchronizacji = {
  trwa: false,
  ostatniaUdana: null,
  wKolejce: 0,
  najstarszaCzeka: null,
  blad: null,
  odciecie: null,
  resetHasla: false,
  wymagaAktualizacji: false,
};

const sluchacze = new Set<(s: StanSynchronizacji) => void>();

export function obserwujSynchronizacje(f: (s: StanSynchronizacji) => void): () => void {
  sluchacze.add(f);
  f(stan);
  return () => { sluchacze.delete(f); };
}

export const stanSynchronizacji = () => stan;

function ustawStan(zmiany: Partial<StanSynchronizacji>) {
  stan = { ...stan, ...zmiany };
  for (const f of sluchacze) f(stan);
}

/** Odswieza liczniki kolejki - wolane po kazdym zapisie z ekranow (D5). */
export async function odswiezLicznikiKolejki(): Promise<void> {
  ustawStan({
    wKolejce: await liczbaWKolejce(),
    najstarszaCzeka: await najstarszaPozycja(),
  });
}

export async function wczytajStanZBazy(): Promise<void> {
  ustawStan({
    ostatniaUdana: await pobierzMeta('ostatnia_udana_sync'),
    wKolejce: await liczbaWKolejce(),
    najstarszaCzeka: await najstarszaPozycja(),
  });
}

/* ====================================================================== */
/*  A4 - samoczynne czyszczenie po dlugim braku kontaktu z serwerem       */
/* ====================================================================== */

export async function sprawdzWygasniecieOffline(): Promise<boolean> {
  const token = await pobierzToken();
  if (!token) return false;

  const ostatnia = await pobierzMeta('ostatnia_udana_sync');
  if (!ostatnia) return false; // jeszcze nigdy nie bylo synchronizacji

  const dni = Number(await pobierzMeta('wygasniecie_offline_dni'))
    || DOMYSLNE_WYGASNIECIE_OFFLINE_DNI;
  const granica = Date.now() - dni * 86_400_000;

  if (new Date(ostatnia).getTime() < granica) {
    await wyczyscWszystko();
    ustawStan({
      odciecie: {
        kod: 'WYCZYSC',
        powod: `Telefon nie polaczyl sie z serwerem od ponad ${dni} dni. `
          + 'Dane zostaly skasowane. Popros administratora o ponowne przyznanie dostepu.',
      },
    });
    return true;
  }
  return false;
}

/* ====================================================================== */
/*  Zapis danych pobranych z serwera                                      */
/* ====================================================================== */

const KOLUMNY_KLIENTA = ['nazwa', 'telefon', 'email', 'adres', 'nip', 'notatki',
  'zrobione_o', 'zapisane_o', 'usuniete_o'] as const;
const KOLUMNY_WIZYTY = ['klient_id', 'auto', 'tytul', 'opis', 'status', 'priorytet',
  'data_wizyty', 'data_zamkniecia', 'przebieg', 'koszt', 'numer_roboczy',
  'numer_oficjalny', 'zrobione_o', 'zapisane_o', 'usuniete_o'] as const;

/**
 * Wiersze z serwera nadpisuja lokalne - Z JEDNYM WYJATKIEM: rekordy, ktore
 * maja jeszcze cos w kolejce (oczekuje = 1). Ich lokalna wersja jest
 * swiezsza z punktu widzenia mechanika; serwerowa dojdzie przy nastepnym
 * pobraniu, juz po opróznieniu kolejki. Bez tego wpisany przed chwila opis
 * migalby na ekranie: znikal i wracal.
 */
async function zapiszPobrane(tabela: 'klienci' | 'wizyty', wiersze: any[]): Promise<void> {
  if (!wiersze.length) return;
  const db = await baza();
  const kolumny = tabela === 'klienci' ? KOLUMNY_KLIENTA : KOLUMNY_WIZYTY;
  const nazwy = ['id', ...kolumny];
  const znaki = nazwy.map(() => '?').join(', ');
  const aktualizacja = kolumny.map((k) => `${k} = excluded.${k}`).join(', ');

  await db.withTransactionAsync(async () => {
    for (const w of wiersze) {
      const wartosci = nazwy.map((k) => (w[k] === undefined ? null : w[k]));
      await db.runAsync(
        `INSERT INTO ${tabela} (${nazwy.join(', ')}) VALUES (${znaki})
         ON CONFLICT(id) DO UPDATE SET ${aktualizacja}
         WHERE ${tabela}.oczekuje = 0`,
        ...wartosci as any[],
      );
    }
  });
}

/* ====================================================================== */
/*  Wysylka kolejki                                                       */
/* ====================================================================== */

type WynikWysylki = { wyslano: number; kwarantanna: number; przerwane: boolean };

async function wyslijKolejke(token: string): Promise<WynikWysylki> {
  const db = await baza();
  let wyslano = 0;
  let kwarantanna = 0;

  // D7: maksymalnie kilka paczek na cykl, zeby nie zajac lacza na minuty.
  for (let paczka = 0; paczka < 20; paczka += 1) {
    const pozycje = await pobierzPaczke(ZMIAN_NA_PACZKE);
    if (!pozycje.length) break;

    const zmiany: ZmianaDoWyslania[] = pozycje.map((p) => ({
      id_lokalne: String(p.id),
      tabela: p.tabela,
      rekord_id: p.rekord_id,
      operacja: p.operacja,
      pola: JSON.parse(p.pola),
      zrobione_o: p.zrobione_o,
    }));

    let odpowiedz;
    try {
      odpowiedz = await wyslijZmiany(token, zmiany);
    } catch (err) {
      if (err instanceof BladSieci) {
        // B8: pozycje ZOSTAJA w kolejce. Nic nie ginie.
        await zanotujNieudanaProbe(pozycje.map((p) => p.id), err.message);
        return { wyslano, kwarantanna, przerwane: true };
      }
      throw err; // BladDostepu obsluguje wyzej
    }

    const przyjete: number[] = [];
    for (const wynik of odpowiedz.wyniki ?? []) {
      przyjete.push(Number(wynik.id_lokalne));
      if (wynik.status === 'kwarantanna') kwarantanna += 1;
      else wyslano += 1;

      // B5: serwer nadal numer oficjalny - zapisujemy go u siebie.
      if (wynik.numer_oficjalny && wynik.id) {
        await db.runAsync('UPDATE wizyty SET numer_oficjalny = ? WHERE id = ?',
          wynik.numer_oficjalny, wynik.id);
      }
    }
    await usunZKolejki(przyjete);

    if (odpowiedz.polecenia?.reset_hasla) ustawStan({ resetHasla: true });
  }

  return { wyslano, kwarantanna, przerwane: false };
}

/* ====================================================================== */
/*  Pobranie danych                                                       */
/* ====================================================================== */

async function pobierzWszystko(token: string): Promise<void> {
  for (let strona = 0; strona < 40; strona += 1) {
    const kursory = {
      klienci: await pobierzMetaJson<any>('kursor_klienci', null),
      wizyty: await pobierzMetaJson<any>('kursor_wizyty', null),
    };

    const odp = await pobierzZmiany(token, kursory, WIERSZY_NA_STRONE);

    if (odp.wymaga_aktualizacji || odp.kod === 'WYMAGANA_AKTUALIZACJA') {
      ustawStan({ wymagaAktualizacji: true });
      return;
    }
    ustawStan({ wymagaAktualizacji: false });

    await zapiszPobrane('klienci', odp.klienci ?? []);
    await zapiszPobrane('wizyty', odp.wizyty ?? []);

    if (odp.kursory?.klienci) await ustawMetaJson('kursor_klienci', odp.kursory.klienci);
    if (odp.kursory?.wizyty) await ustawMetaJson('kursor_wizyty', odp.kursory.wizyty);

    // Ustawienia warsztatu moga sie zmienic w panelu - przyjmujemy je od serwera.
    if (odp.warsztat) {
      await ustawMeta('warsztat_nazwa', odp.warsztat.nazwa);
      await ustawMeta('warsztat_prefiks', odp.warsztat.prefiks);
      await ustawMeta('okno_dni', String(odp.warsztat.okno_dni));
    }
    if (odp.mechanik) await ustawMeta('mechanik_imie', odp.mechanik.imie);
    if (odp.wygasniecie_offline_dni) {
      await ustawMeta('wygasniecie_offline_dni', String(odp.wygasniecie_offline_dni));
    }
    if (odp.polecenia?.reset_hasla) ustawStan({ resetHasla: true });

    if (!odp.wiecej) break;
  }
}

/* ====================================================================== */
/*  Cykl synchronizacji                                                   */
/* ====================================================================== */

let ostatniaProba = 0;

export async function synchronizuj(
  opcje: { wymuszona?: boolean } = {},
): Promise<StanSynchronizacji> {
  if (stan.trwa) return stan;

  // D7: nie mlocimy serwera - automatyczne cykle maja minimalna przerwe.
  if (!opcje.wymuszona && Date.now() - ostatniaProba < MIN_PRZERWA_SYNC_MS) return stan;
  ostatniaProba = Date.now();

  if (await sprawdzWygasniecieOffline()) return stan;

  const token = await pobierzToken();
  if (!token) return stan;

  ustawStan({ trwa: true, blad: null });

  try {
    // Kolejnosc ma znaczenie: najpierw oddajemy swoje zmiany, potem bierzemy
    // cudze. Inaczej pobrane dane nadpisalyby wlasnie zrobiony wpis.
    const wysylka = await wyslijKolejke(token);
    if (!wysylka.przerwane) await pobierzWszystko(token);

    const czas = new Date().toISOString();
    await ustawMeta('ostatnia_udana_sync', czas);

    // A3 / D10: przycinamy lokalna baze do okna warsztatu.
    const okno = Number(await pobierzMeta('okno_dni')) || DOMYSLNE_OKNO_DNI;
    await posprzatajPozaOknem(okno);

    ustawStan({
      trwa: false,
      ostatniaUdana: czas,
      blad: wysylka.przerwane ? 'Czesc zmian czeka na lepszy zasieg.' : null,
      wKolejce: await liczbaWKolejce(),
      najstarszaCzeka: await najstarszaPozycja(),
    });
  } catch (err) {
    if (err instanceof BladDostepu) {
      // A6: administrator odebral dostep albo kazal wyczyscic urzadzenie.
      await wyczyscWszystko();
      ustawStan({
        trwa: false,
        odciecie: { kod: err.kod, powod: err.powod },
        wKolejce: 0,
        najstarszaCzeka: null,
      });
      return stan;
    }
    // D1: kazdy inny blad to blad przejsciowy. Nic nie kasujemy.
    ustawStan({
      trwa: false,
      blad: err instanceof Error ? err.message : 'Nie udalo sie polaczyc z serwerem.',
      wKolejce: await liczbaWKolejce(),
      najstarszaCzeka: await najstarszaPozycja(),
    });
  }

  return stan;
}

export function potwierdzOdciecie(): void {
  ustawStan({ odciecie: null });
}

export function potwierdzResetHasla(): void {
  ustawStan({ resetHasla: false });
}
