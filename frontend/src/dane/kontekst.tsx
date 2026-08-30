/**
 * Stan calej aplikacji: sesja urzadzenia, blokada ekranu, synchronizacja.
 *
 * A5 - Wlasna blokada aplikacji: haslo albo odcisk palca przy uruchomieniu,
 *      po 5 minutach bezczynnosci i po kazdym przejsciu w tlo. Telefon lezacy
 *      otwarty na warsztacie nie pokazuje danych klientow.
 * D1 - Faza aplikacji zalezy WYLACZNIE od tego, co jest na telefonie
 *      (token w Keychain, haslo, lokalna baza). Zaden brak sieci nie
 *      przelaczy mechanika na ekran logowania.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { otworzBaze } from './baza';
import {
  czyHasloUstawione, daneMechanika, pobierzToken, wyczyscWszystko,
} from './sesja';
import {
  StanSynchronizacji, obserwujSynchronizacje, potwierdzOdciecie, potwierdzResetHasla,
  sprawdzWygasniecieOffline, stanSynchronizacji, synchronizuj, wczytajStanZBazy,
} from './synchronizacja';
import { BEZCZYNNOSC_MS, OKRES_SYNC_MS } from './konfiguracja';

export type Faza =
  | 'ladowanie'      // otwieramy baze, czytamy Keychain
  | 'parowanie'      // brak tokenu - trzeba poprosic administratora o dostep
  | 'ustaw_haslo'    // dostep jest, mechanik wybiera wlasne haslo
  | 'zablokowana'    // haslo jest, trzeba je podac
  | 'gotowa';

type Kontekst = {
  faza: Faza;
  mechanik: string | null;
  warsztat: string | null;
  /** 'administrator' odblokowuje ekran zarzadzania dostepem. Nic wiecej. */
  rola: string;
  czyAdministrator: boolean;
  sync: StanSynchronizacji;
  /** Po udanym parowaniu / ustawieniu hasla / odblokowaniu. */
  odswiezFaze: () => Promise<void>;
  odblokowano: () => void;
  zablokuj: () => void;
  aktywnosc: () => void;
  wyloguj: () => Promise<void>;
  potwierdzOdciecie: () => void;
  potwierdzResetHasla: () => void;
  synchronizuj: (opcje?: { wymuszona?: boolean }) => Promise<unknown>;
};

const KontekstAplikacji = createContext<Kontekst | null>(null);

export function AplikacjaProvider({ children }: { children: React.ReactNode }) {
  const [faza, setFaza] = useState<Faza>('ladowanie');
  const [mechanik, setMechanik] = useState<string | null>(null);
  const [warsztat, setWarsztat] = useState<string | null>(null);
  const [rola, setRola] = useState<string>('mechanik');
  const [sync, setSync] = useState<StanSynchronizacji>(stanSynchronizacji());

  const odblokowanaDo = useRef<number>(0);
  const stanTla = useRef<AppStateStatus>(AppState.currentState);

  /** Ustala, co pokazac: parowanie, ustawienie hasla, blokade czy aplikacje. */
  const odswiezFaze = useCallback(async () => {
    await otworzBaze();
    await wczytajStanZBazy();

    const token = await pobierzToken();
    if (!token) {
      setFaza('parowanie');
      return;
    }
    const { mechanik: imie, warsztat: nazwa, rola: obecnaRola } = await daneMechanika();
    setMechanik(imie);
    setWarsztat(nazwa);
    setRola(obecnaRola);

    if (!(await czyHasloUstawione())) {
      setFaza('ustaw_haslo');
      return;
    }
    setFaza(odblokowanaDo.current > Date.now() ? 'gotowa' : 'zablokowana');
  }, []);

  /* --------------------------- start aplikacji -------------------------- */
  useEffect(() => {
    let zywy = true;
    (async () => {
      await otworzBaze();
      // A4: telefon, ktory od dawna nie widzial serwera, czysci sie sam.
      await sprawdzWygasniecieOffline();
      if (!zywy) return;
      await odswiezFaze();
    })();
    return () => { zywy = false; };
  }, [odswiezFaze]);

  /* --------------------------- stan synchronizacji ---------------------- */
  useEffect(() => obserwujSynchronizacje(setSync), []);

  // Rola moze sie zmienic po stronie serwera (administrator kogos awansowal
  // albo odebral uprawnienia) - odczytujemy ja po kazdej synchronizacji.
  useEffect(() => {
    if (sync.trwa) return;
    daneMechanika().then(({ rola: swieza }) => setRola(swieza));
  }, [sync.trwa, sync.ostatniaUdana]);

  /* --------------------------- A5: bezczynnosc -------------------------- */

  const aktywnosc = useCallback(() => {
    if (faza === 'gotowa') odblokowanaDo.current = Date.now() + BEZCZYNNOSC_MS;
  }, [faza]);

  const zablokuj = useCallback(() => {
    odblokowanaDo.current = 0;
    setFaza((obecna) => (obecna === 'gotowa' ? 'zablokowana' : obecna));
  }, []);

  const odblokowano = useCallback(() => {
    odblokowanaDo.current = Date.now() + BEZCZYNNOSC_MS;
    setFaza('gotowa');
  }, []);

  useEffect(() => {
    if (faza !== 'gotowa') return undefined;
    const licznik = setInterval(() => {
      if (odblokowanaDo.current <= Date.now()) zablokuj();
    }, 15_000);
    return () => clearInterval(licznik);
  }, [faza, zablokuj]);

  /* ------------------ A5: przejscie w tlo zamyka aplikacje --------------- */
  useEffect(() => {
    const subskrypcja = AppState.addEventListener('change', (nowy) => {
      const bylaAktywna = stanTla.current === 'active';
      stanTla.current = nowy;

      if (bylaAktywna && nowy.match(/inactive|background/)) {
        zablokuj();
      }
      if (nowy === 'active') {
        // Powrot do aplikacji: sprawdzamy, czy w miedzyczasie nie minal
        // termin samoczynnego wyczyszczenia, i probujemy dogonic serwer.
        sprawdzWygasniecieOffline().then((wyczyszczono) => {
          if (wyczyszczono) odswiezFaze();
          else synchronizuj();
        });
      }
    });
    return () => subskrypcja.remove();
  }, [zablokuj, odswiezFaze]);

  /* -------------------- cykliczna synchronizacja w tle ------------------- */
  useEffect(() => {
    if (faza !== 'gotowa') return undefined;
    synchronizuj();
    const licznik = setInterval(() => { synchronizuj(); }, OKRES_SYNC_MS);
    return () => clearInterval(licznik);
  }, [faza]);

  /* ---------------- A6: dostep odebrany - wracamy do parowania ----------- */
  useEffect(() => {
    if (sync.odciecie) {
      odblokowanaDo.current = 0;
      setFaza('parowanie');
    }
  }, [sync.odciecie]);

  /* ----------- administrator kazal ustawic nowe haslo -------------------- */
  useEffect(() => {
    if (sync.resetHasla && faza === 'gotowa') setFaza('ustaw_haslo');
  }, [sync.resetHasla, faza]);

  const wyloguj = useCallback(async () => {
    await wyczyscWszystko();
    odblokowanaDo.current = 0;
    setMechanik(null);
    setWarsztat(null);
    setRola('mechanik');
    setFaza('parowanie');
  }, []);

  const wartosc = useMemo<Kontekst>(() => ({
    faza, mechanik, warsztat, sync,
    rola, czyAdministrator: rola === 'administrator',
    odswiezFaze, odblokowano, zablokuj, aktywnosc, wyloguj,
    potwierdzOdciecie, potwierdzResetHasla, synchronizuj,
  }), [faza, mechanik, warsztat, sync, rola,
       odswiezFaze, odblokowano, zablokuj, aktywnosc, wyloguj]);

  return (
    <KontekstAplikacji.Provider value={wartosc}>{children}</KontekstAplikacji.Provider>
  );
}

export function useAplikacja(): Kontekst {
  const k = useContext(KontekstAplikacji);
  if (!k) throw new Error('useAplikacja poza AplikacjaProvider');
  return k;
}
