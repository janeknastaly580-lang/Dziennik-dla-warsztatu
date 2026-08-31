/**
 * Stan calej aplikacji: sesja urzadzenia, blokada ekranu, synchronizacja.
 *
 * A5 - Wlasna blokada aplikacji: haslo albo odcisk palca PRZY URUCHOMIENIU
 *      APLIKACJI. Raz odblokowana sesja trwa, dopoki aplikacja zyje -
 *      przelaczenie sie na inna aplikacje, odebranie telefonu czy odlozenie
 *      go na chwile NIE zamyka dostepu. Blokada wraca dopiero, gdy system
 *      ubije proces (a w przegladarce - gdy zamkniesz karte i wejdziesz
 *      na strone od nowa), bo wtedy stan w pamieci przepada.
 *
 *      Swiadomy kompromis, na zyczenie warsztatu: poprzednia wersja blokowala
 *      sie po 5 minutach bezczynnosci i przy kazdym przejsciu w tlo, przez co
 *      mechanik wpisywal haslo kilkanascie razy dziennie i zaczynal ustawiac
 *      jednoznakowe. Kto chce zablokowac aplikacje od razu, ma przycisk
 *      "Zablokuj aplikacje teraz" w ustawieniach.
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
import { TRYB_PODGLADU } from './pamiecBezpieczna';
import {
  StanSynchronizacji, obserwujSynchronizacje, potwierdzOdciecie, potwierdzResetHasla,
  sprawdzWygasniecieOffline, stanSynchronizacji, synchronizuj, wczytajStanZBazy,
} from './synchronizacja';
import { OKRES_SYNC_MS } from './konfiguracja';

export type Faza =
  | 'ladowanie'      // otwieramy baze, czytamy Keychain
  | 'brak_bazy'      // lokalna baza nie chce sie otworzyc - patrz `bladBazy`
  | 'parowanie'      // brak tokenu - trzeba poprosic administratora o dostep
  | 'ustaw_haslo'    // dostep jest, mechanik wybiera wlasne haslo
  | 'zablokowana'    // haslo jest, trzeba je podac
  | 'gotowa';

type Kontekst = {
  faza: Faza;
  /** Wypelnione tylko w fazie 'brak_bazy' - gotowy tekst dla uzytkownika. */
  bladBazy: string | null;
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
  wyloguj: () => Promise<void>;
  /** Ponowna proba otwarcia bazy po fazie 'brak_bazy'. */
  sprobujPonownie: () => void;
  potwierdzOdciecie: () => void;
  potwierdzResetHasla: () => void;
  synchronizuj: (opcje?: { wymuszona?: boolean }) => Promise<unknown>;
};

const KontekstAplikacji = createContext<Kontekst | null>(null);

export function AplikacjaProvider({ children }: { children: React.ReactNode }) {
  const [faza, setFaza] = useState<Faza>('ladowanie');
  const [bladBazy, setBladBazy] = useState<string | null>(null);
  const [mechanik, setMechanik] = useState<string | null>(null);
  const [warsztat, setWarsztat] = useState<string | null>(null);
  const [rola, setRola] = useState<string>('mechanik');
  const [sync, setSync] = useState<StanSynchronizacji>(stanSynchronizacji());

  /**
   * Czy ta sesja aplikacji zostala juz odblokowana haslem. Zwykly `useRef`,
   * a wiec zmienna W PAMIECI: przepada razem z procesem aplikacji (na
   * telefonie) albo z zamknieciem karty (w przegladarce). Dokladnie to jest
   * definicja "trzeba wpisac haslo od nowa".
   */
  const odblokowana = useRef(false);
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
    setFaza(odblokowana.current ? 'gotowa' : 'zablokowana');
  }, []);

  /* --------------------------- start aplikacji -------------------------- */

  /**
   * Gdy lokalna baza nie chce sie otworzyc, aplikacja MUSI o tym powiedziec.
   * Wczesniej wyjatek lecial w pustke i ekran zostawal na wieki na kreciolku
   * "Otwieranie danych warsztatu..." - najgorszy mozliwy komunikat, bo nie
   * mowi ani co jest zle, ani co z tym zrobic.
   *
   * W przegladarce zdarza sie to z jednego, bardzo konkretnego powodu:
   * SQLite trzyma swoje pliki (OPFS) na wylacznosc jednej karty. Druga karta
   * z ta sama aplikacja nie otworzy bazy, dopoki pierwsza jest otwarta.
   */
  const [proba, setProba] = useState(0);
  const sprobujPonownie = useCallback(() => {
    // W przegladarce ponowna proba w tej samej karcie nie ma szans: gdy raz
    // nie uda sie zlozyc WebAssembly, watek roboczy expo-sqlite zapamietuje to
    // na stale i kazde nastepne zapytanie konczy sie tak samo. Jedyne, co
    // pomaga, to swiezy watek - czyli przeladowanie strony.
    if (TRYB_PODGLADU && typeof location !== 'undefined') {
      location.reload();
      return;
    }
    setBladBazy(null);
    setFaza('ladowanie');
    setProba((n) => n + 1);
  }, []);

  useEffect(() => {
    let zywy = true;
    (async () => {
      try {
        await otworzBaze();
        // A4: telefon, ktory od dawna nie widzial serwera, czysci sie sam.
        await sprawdzWygasniecieOffline();
        if (!zywy) return;
        await odswiezFaze();
      } catch (err) {
        if (!zywy) return;
        setBladBazy(
          TRYB_PODGLADU
            ? 'Nie udalo sie otworzyc lokalnej bazy. Najczestsza przyczyna w '
              + 'przegladarce: ta sama aplikacja jest juz otwarta w innej karcie, '
              + 'a SQLite trzyma swoje pliki na wylacznosc. Zamknij pozostale karty '
              + 'z tym adresem, a potem odswiez te.'
            : `Nie udalo sie otworzyc lokalnej bazy danych. ${
              err instanceof Error ? err.message : String(err)}`,
        );
        setFaza('brak_bazy');
      }
    })();
    return () => { zywy = false; };
  }, [odswiezFaze, proba]);

  /* --------------------------- stan synchronizacji ---------------------- */
  useEffect(() => obserwujSynchronizacje(setSync), []);

  // Rola moze sie zmienic po stronie serwera (administrator kogos awansowal
  // albo odebral uprawnienia) - odczytujemy ja po kazdej synchronizacji.
  useEffect(() => {
    if (sync.trwa) return;
    daneMechanika().then(({ rola: swieza }) => setRola(swieza));
  }, [sync.trwa, sync.ostatniaUdana]);

  /* ------------------------- A5: blokada aplikacji ---------------------- */
  /* Blokada zapada raz - przy starcie aplikacji. Nie ma tu ani licznika
     bezczynnosci, ani reakcji na przejscie w tlo: `odblokowana` zyje
     w pamieci procesu, wiec sam fakt, ze aplikacja wstala od nowa, oznacza
     "podaj haslo". Przelaczenie sie na SMS-y i powrot - nie oznacza. */

  const zablokuj = useCallback(() => {
    odblokowana.current = false;
    setFaza((obecna) => (obecna === 'gotowa' ? 'zablokowana' : obecna));
  }, []);

  const odblokowano = useCallback(() => {
    odblokowana.current = true;
    setFaza('gotowa');
  }, []);

  /* ---------------- powrot z tla: dogon serwer, nie blokuj --------------- */
  useEffect(() => {
    const subskrypcja = AppState.addEventListener('change', (nowy) => {
      stanTla.current = nowy;
      if (nowy !== 'active') return;
      // Sprawdzamy tylko, czy w miedzyczasie nie minal termin samoczynnego
      // wyczyszczenia (A4), i probujemy dogonic serwer.
      sprawdzWygasniecieOffline().then((wyczyszczono) => {
        if (wyczyszczono) odswiezFaze();
        else synchronizuj();
      });
    });
    return () => subskrypcja.remove();
  }, [odswiezFaze]);

  /* -------------------- cykliczna synchronizacja w tle -------------------
     Chodzi takze przy ZABLOKOWANYM ekranie. Dwa powody: dane sa swieze juz
     w chwili wpisania hasla, a polecenie "zablokuj / wyczysc ten telefon"
     dociera nawet wtedy, gdy nikt tego telefonu nie odblokowuje (A4, A6). */
  useEffect(() => {
    if (faza !== 'gotowa' && faza !== 'zablokowana') return undefined;
    synchronizuj();
    const licznik = setInterval(() => { synchronizuj(); }, OKRES_SYNC_MS);
    return () => clearInterval(licznik);
  }, [faza]);

  /* ------------- wrocil internet: rusz od razu, nie czekaj na cykl ------- */
  useEffect(() => {
    // Zdarzenie `online` istnieje tylko w przegladarce; na telefonie te role
    // pelni powrot aplikacji z tla (wyzej) i cykliczny licznik.
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const naSiec = () => { synchronizuj(); };
    window.addEventListener('online', naSiec);
    return () => window.removeEventListener('online', naSiec);
  }, []);

  /* ---------------- A6: dostep odebrany - wracamy do parowania ----------- */
  useEffect(() => {
    if (sync.odciecie) {
      odblokowana.current = false;
      setFaza('parowanie');
    }
  }, [sync.odciecie]);

  /* ----------- administrator kazal ustawic nowe haslo -------------------- */
  useEffect(() => {
    if (sync.resetHasla && faza === 'gotowa') setFaza('ustaw_haslo');
  }, [sync.resetHasla, faza]);

  const wyloguj = useCallback(async () => {
    await wyczyscWszystko();
    odblokowana.current = false;
    setMechanik(null);
    setWarsztat(null);
    setRola('mechanik');
    setFaza('parowanie');
  }, []);

  const wartosc = useMemo<Kontekst>(() => ({
    faza, bladBazy, mechanik, warsztat, sync,
    rola, czyAdministrator: rola === 'administrator',
    odswiezFaze, odblokowano, zablokuj, wyloguj, sprobujPonownie,
    potwierdzOdciecie, potwierdzResetHasla, synchronizuj,
  }), [faza, bladBazy, mechanik, warsztat, sync, rola,
       odswiezFaze, odblokowano, zablokuj, wyloguj, sprobujPonownie]);

  return (
    <KontekstAplikacji.Provider value={wartosc}>{children}</KontekstAplikacji.Provider>
  );
}

export function useAplikacja(): Kontekst {
  const k = useContext(KontekstAplikacji);
  if (!k) throw new Error('useAplikacja poza AplikacjaProvider');
  return k;
}
