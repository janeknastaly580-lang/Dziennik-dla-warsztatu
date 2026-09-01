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
import * as Network from 'expo-network';

import {
  DOMYSLNE_OKNO_DNI, DOMYSLNE_WYGASNIECIE_OFFLINE_DNI, MIN_PRZERWA_SYNC_MS,
  PONOWIENIE_MAKS_MS, PONOWIENIE_MIN_MS, WIERSZY_NA_STRONE, ZMIAN_NA_PACZKE,
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
  /**
   * Serwer swiadomie odmowil wykonania operacji (np. proba usuniecia wizyty
   * przed uplywem karencji). To NIE jest awaria - mechanik ma zobaczyc powod.
   */
  odmowa: string | null;
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
  odmowa: null,
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

/**
 * Odswieza liczniki kolejki - wolane po kazdym zapisie z ekranow (D5) -
 * i OD RAZU probuje wyslac to, co wlasnie doszlo.
 *
 * Synchronizacja nie ma juz zadnego przycisku na ekranach roboczych, wiec
 * nikt jej recznie nie uruchomi. Musi wiec ruszac sama, natychmiast po
 * zapisie: przy dzialajacym internecie zmiana jest na serwerze, zanim
 * mechanik zdazy wrocic do listy. Bez sieci nic sie nie dzieje - pozycja
 * zostaje w kolejce, a nastepny cykl sprobuje ponownie (B8, D1).
 *
 * Wysylki nie czekamy: ekran ma sie odswiezyc od razu, a nie po podrozy
 * do serwera i z powrotem.
 */
export async function odswiezLicznikiKolejki(): Promise<void> {
  ustawStan({
    wKolejce: await liczbaWKolejce(),
    najstarszaCzeka: await najstarszaPozycja(),
  });
  void synchronizuj().catch(() => undefined);
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
  'data_wizyty', 'godzina_od', 'godzina_do', 'data_zamkniecia', 'przebieg', 'koszt',
  'numer_roboczy',
  'numer_oficjalny', 'naprawione_o', 'zrobione_o', 'zapisane_o', 'usuniete_o'] as const;

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
    const wedlugId = new Map(pozycje.map((p) => [String(p.id), p]));

    for (const wynik of odpowiedz.wyniki ?? []) {
      przyjete.push(Number(wynik.id_lokalne));
      if (wynik.status === 'kwarantanna') kwarantanna += 1;
      else wyslano += 1;

      // B5: serwer nadal numer oficjalny - zapisujemy go u siebie.
      if (wynik.numer_oficjalny && wynik.id) {
        await db.runAsync('UPDATE wizyty SET numer_oficjalny = ? WHERE id = ?',
          wynik.numer_oficjalny, wynik.id);
      }

      /* --------------------------------------------------------------
       * ODMOWA - serwer wykonal swoja robote i powiedzial "nie wolno"
       * (np. karencja usuwania wizyty). Lokalnie rekord jest juz
       * oznaczony jako usuniety, wiec musimy go COFNAC, inaczej mechanik
       * widzialby zniknieta wizyte az do nastepnego pelnego pobrania.
       * -------------------------------------------------------------- */
      if (wynik.status === 'odmowa') {
        const pozycja = wedlugId.get(String(wynik.id_lokalne));
        if (pozycja && pozycja.operacja === 'usun'
            && (pozycja.tabela === 'wizyty' || pozycja.tabela === 'klienci')) {
          await db.runAsync(
            `UPDATE ${pozycja.tabela} SET usuniete_o = NULL WHERE id = ?`,
            pozycja.rekord_id,
          );
        }
        ustawStan({ odmowa: wynik.blad ?? wynik.powod ?? 'Serwer nie pozwolil na te zmiane.' });
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
    if (odp.mechanik) {
      await ustawMeta('mechanik_imie', odp.mechanik.imie);
      // Odebranie uprawnien administratora ma dzialac natychmiast - dlatego
      // rola przychodzi z serwera przy kazdym pobraniu, a nie tylko raz,
      // przy parowaniu.
      await ustawMeta('rola', odp.mechanik.rola ?? 'mechanik');
    }
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

    const zostalo = await liczbaWKolejce();
    ustawStan({
      trwa: false,
      ostatniaUdana: czas,
      blad: wysylka.przerwane ? 'Czesc zmian czeka na lepszy zasieg.' : null,
      wKolejce: zostalo,
      najstarszaCzeka: await najstarszaPozycja(),
    });
    // Kolejka pusta gasi ponawianie; niepusta - podkreca je z powrotem.
    ustawRytmPonowien(zostalo > 0, !wysylka.przerwane);
  } catch (err) {
    if (err instanceof BladDostepu) {
      // A6: administrator odebral dostep albo kazal wyczyscic urzadzenie.
      await wyczyscWszystko();
      anulujPonowienie();
      ustawStan({
        trwa: false,
        odciecie: { kod: err.kod, powod: err.powod },
        wKolejce: 0,
        najstarszaCzeka: null,
      });
      return stan;
    }
    // D1: kazdy inny blad to blad przejsciowy. Nic nie kasujemy.
    const zostalo = await liczbaWKolejce();
    ustawStan({
      trwa: false,
      blad: err instanceof Error ? err.message : 'Nie udalo sie polaczyc z serwerem.',
      wKolejce: zostalo,
      najstarszaCzeka: await najstarszaPozycja(),
    });
    // Nie udalo sie - probujemy dalej, coraz rzadziej, az do skutku.
    ustawRytmPonowien(zostalo > 0, false);
  }

  return stan;
}

export function potwierdzOdciecie(): void {
  ustawStan({ odciecie: null });
}

export function potwierdzResetHasla(): void {
  ustawStan({ resetHasla: false });
}

/** Mechanik przeczytal komunikat o odmowie - gasimy go. */
export function potwierdzOdmowe(): void {
  ustawStan({ odmowa: null });
}

/* ====================================================================== */
/*  D7 / D9 - DOGANIANIE SERWERA PO PRZERWIE W SIECI                      */
/*                                                                        */
/*  Dwa niezalezne mechanizmy, bo zaden z osobna nie wystarcza:            */
/*                                                                        */
/*   1. Nasluch stanu sieci - reaguje w ulamku sekundy, gdy Wi-Fi albo    */
/*      dane wracaja. Jest jednak ZAWODNY: `expo-network` potrafi zglosic  */
/*      "polaczony" przy martwym laczu (hotspot bez internetu, sieciowka   */
/*      hotelowa przed zalogowaniem) albo w ogole nie odpalic zdarzenia.   */
/*                                                                        */
/*   2. Ponawianie z rosnaca przerwa - chodzi ZAWSZE, gdy w kolejce cos    */
/*      czeka, niezaleznie od tego, co mowi system: 5 s, 10 s, 20 s...     */
/*      do 5 minut. To ono jest gwarancja, ze dane w koncu dojda.          */
/*                                                                        */
/*  Nasluch jest przyspieszaczem, nie fundamentem. Gdyby zawiodl, kolejka  */
/*  i tak sie oprozni - najwyzej minute pozniej.                          */
/* ====================================================================== */

let czasomierzPonowienia: ReturnType<typeof setTimeout> | null = null;
let przerwaPonowienia = PONOWIENIE_MIN_MS;

function anulujPonowienie() {
  if (czasomierzPonowienia) clearTimeout(czasomierzPonowienia);
  czasomierzPonowienia = null;
}

/** Planuje kolejna probe, jesli w kolejce cos zostalo. */
function zaplanujPonowienie() {
  anulujPonowienie();
  czasomierzPonowienia = setTimeout(() => {
    czasomierzPonowienia = null;
    void synchronizuj({ wymuszona: true }).catch(() => undefined);
  }, przerwaPonowienia);
}

/** Po kazdym cyklu: pusta kolejka gasi ponawianie, niepusta je podkreca. */
function ustawRytmPonowien(cosZostalo: boolean, udaloSie: boolean) {
  if (!cosZostalo) {
    anulujPonowienie();
    przerwaPonowienia = PONOWIENIE_MIN_MS;
    return;
  }
  // Udany cykl, ale kolejka niepusta (np. duza paczka) - probujemy zaraz.
  // Nieudany - odsuwamy sie dwukrotnie, do gornego limitu.
  przerwaPonowienia = udaloSie
    ? PONOWIENIE_MIN_MS
    : Math.min(przerwaPonowienia * 2, PONOWIENIE_MAKS_MS);
  zaplanujPonowienie();
}

/**
 * Wlacza nasluch stanu sieci. Zwraca funkcje, ktora go wylacza.
 * Bezpieczne na kazdej platformie - w przegladarce `expo-network` nie ma
 * nasluchu i po prostu go tam nie ma, a ponawianie z punktu 2 dziala dalej.
 */
export function uruchomWznawianiePoSieci(): () => void {
  let bylBezSieci = false;

  const reaguj = (polaczony: boolean) => {
    if (polaczony && bylBezSieci) {
      // Siec wrocila - nie czekamy na kolejny tik, ruszamy natychmiast.
      przerwaPonowienia = PONOWIENIE_MIN_MS;
      void synchronizuj({ wymuszona: true }).catch(() => undefined);
    }
    bylBezSieci = !polaczony;
  };

  // Stan poczatkowy, zeby pierwszy powrot sieci zostal rozpoznany.
  Network.getNetworkStateAsync()
    .then((s) => { bylBezSieci = !s.isConnected; })
    .catch(() => { bylBezSieci = false; });

  try {
    const subskrypcja = Network.addNetworkStateListener((s) => {
      reaguj(!!s.isConnected);
    });
    return () => {
      try {
        subskrypcja.remove();
      } catch {
        // Wylaczenie nasluchu nie moze wysadzic odmontowania ekranu.
      }
    };
  } catch {
    // Platforma bez nasluchu (przegladarka) - zostaje ponawianie z backoffem.
    return () => undefined;
  }
}
