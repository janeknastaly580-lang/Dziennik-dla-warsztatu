/**
 * WARSZTAT - proces glowny aplikacji Windows.
 *
 * Ekrany sa te same, co dotychczas (React Native Web zbudowany przez Expo).
 * Ten plik daje im to, czego przegladarka dac nie moze, a bez czego caly
 * projekt nie mialby sensu:
 *
 *   A4  SZYFROWANA BAZA - plik `warsztat.db` otwiera SQLCipher
 *       (better-sqlite3-multiple-ciphers) 256-bitowym kluczem. Skopiowanie
 *       pliku z dysku albo wyjecie dysku z komputera daje szyfrogram.
 *
 *   A4  KLUCZ POZA BAZA - klucz lezy w `klucze.json` zaszyfrowany przez
 *       `safeStorage`, czyli DPAPI Windows. Odszyfrowuje go WYLACZNIE konto
 *       Windows tego uzytkownika na tym komputerze; administrator domeny ani
 *       inny uzytkownik tego samego komputera nie odczytaja go z pliku.
 *
 *   A12 BEZ KOPII W CHMURZE - dane leza w katalogu aplikacji uzytkownika,
 *       ktorego Windows nie synchronizuje z OneDrive (to nie jest Pulpit ani
 *       Dokumenty). Nic nie wychodzi poza ten komputer poza synchronizacja
 *       z Supabase, ktora robi sama aplikacja.
 *
 * Ekrany NIE maja dostepu do Node - `contextIsolation` i `sandbox` sa
 * wlaczone, a jedyne, co widza, to waskie API wystawione w `mostek.js`.
 */
const { app, BrowserWindow, Menu, ipcMain, protocol, net, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const Baza = require('better-sqlite3-multiple-ciphers');

// Nazwa decyduje o katalogu z danymi (%APPDATA%\Warsztat). Ustawiamy ja
// wprost, zeby program uruchomiony z repozytorium i ten zainstalowany
// z paczki czytaly te sama baze, a nie dwie rozne.
app.setName('Warsztat');

/** Nazwa pliku bazy - ta sama, co w poprzednich wersjach aplikacji. */
const NAZWA_BAZY = 'warsztat.db';
/** Plik z kluczami zaszyfrowanymi przez DPAPI. */
const NAZWA_KLUCZY = 'klucze.json';

/**
 * Adres, spod ktorego ladowane sa ekrany.
 *
 * `app://` zamiast `file://` z dwoch powodow: Expo buduje strone ze
 * sciezkami od korzenia (`/_expo/...`), a plikowy protokol nie ma korzenia;
 * do tego `file://` jest osobnym pochodzeniem dla kazdego pliku, przez co
 * przegladarkowy magazyn danych zachowuje sie nieprzewidywalnie.
 */
const SCHEMAT = 'app';
const ADRES_EKRANOW = `${SCHEMAT}://warsztat`;

/**
 * Polityka bezpieczenstwa tresci. Ekrany moga rozmawiac WYLACZNIE z wlasnymi
 * plikami i z Supabase - nic wiecej nie ma prawa sie wczytac ani wyslac.
 * Po przeniesieniu warsztatu na inny projekt Supabase (inna domena niz
 * *.supabase.co) trzeba dopisac tu jego adres, inaczej synchronizacja
 * zamilknie.
 */
const POLITYKA = [
  "default-src 'self'",
  "script-src 'self'",
  // React Native Web wstrzykuje style w trakcie dzialania - bez tego
  // interfejs zostaje bez zadnego formatowania.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Katalog ze zbudowanymi ekranami: w paczce obok programu, w pracy z repo. */
function katalogEkranow() {
  const spakowane = path.join(process.resourcesPath, 'ekrany');
  if (fs.existsSync(spakowane)) return spakowane;
  return path.join(__dirname, '..', 'frontend', 'dist');
}

/* ===================================================================== */
/*  A4 - klucze w DPAPI                                                   */
/* ===================================================================== */

const plikKluczy = () => path.join(app.getPath('userData'), NAZWA_KLUCZY);

function wczytajKlucze() {
  try {
    return JSON.parse(fs.readFileSync(plikKluczy(), 'utf8'));
  } catch {
    return {};
  }
}

function zapiszKlucze(klucze) {
  fs.writeFileSync(plikKluczy(), JSON.stringify(klucze), { mode: 0o600 });
}

/**
 * Bez DPAPI nie ma gdzie bezpiecznie schowac klucza do bazy, a zapisanie go
 * otwartym tekstem obok zaszyfrowanego pliku byloby zabezpieczeniem na niby.
 * W takiej sytuacji aplikacja ma powiedziec wprost, ze nie dziala.
 */
function sprawdzSzyfrowanie() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Windows nie udostepnia szyfrowania danych aplikacji (DPAPI). '
      + 'Bez niego nie da sie bezpiecznie przechowac klucza do bazy warsztatu.',
    );
  }
}

/* ===================================================================== */
/*  A4 - baza SQLCipher                                                   */
/* ===================================================================== */

let baza = null;

const plikBazy = () => path.join(app.getPath('userData'), NAZWA_BAZY);

function zamknijBaze() {
  try {
    baza?.close();
  } catch {
    // Zamkniecie nie moze przeszkodzic w wylogowaniu ani w zamknieciu okna.
  }
  baza = null;
}

/**
 * Otwiera plik bazy kluczem podanym przez aplikacje. `PRAGMA key` musi byc
 * pierwsza instrukcja - dopiero po niej SQLCipher cokolwiek odczyta. Klucz
 * idzie w postaci surowej (x'...'), wiec nie przechodzi przez wolne
 * wyprowadzanie i nie ma tu miejsca na wstrzykniecie: to 64 znaki szesnastkowe.
 */
function otworzBaze(klucz) {
  if (!/^[0-9a-f]{64}$/.test(String(klucz))) {
    throw new Error('Bledny klucz bazy.');
  }
  zamknijBaze();

  const polaczenie = new Baza(plikBazy());
  polaczenie.pragma(`key = "x'${klucz}'"`);
  // Odczyt czegokolwiek udaje sie tylko przy poprawnym kluczu - to jest
  // sprawdzenie, czy plik faktycznie da sie odszyfrowac.
  polaczenie.prepare('SELECT count(*) AS n FROM sqlite_master').get();

  baza = polaczenie;
}

function wymagajBazy() {
  if (!baza) throw new Error('Baza nie jest otwarta.');
  return baza;
}

/** Kasuje plik bazy razem z dziennikiem WAL - po tym nie ma juz czego czytac. */
function skasujPlikBazy() {
  zamknijBaze();
  for (const koncowka of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(plikBazy() + koncowka, { force: true });
    } catch {
      // Plik moze byc jeszcze zajety - nastepne otwarcie i tak zalozy nowy.
    }
  }
}

/* ===================================================================== */
/*  Most do ekranow                                                       */
/*                                                                        */
/*  Zapytania SQL przychodza z naszego wlasnego kodu ekranow - nie ma tu   */
/*  ani jednej strony z internetu (patrz POLITYKA i blokada nawigacji      */
/*  ponizej), wiec most przekazuje je do bazy tak, jak przyszly.           */
/* ===================================================================== */

function podlaczMost() {
  ipcMain.handle('system:komputer', () => ({
    nazwa: os.hostname(),
    uzytkownik: os.userInfo().username,
    wersja: app.getVersion(),
  }));

  ipcMain.handle('klucz:czytaj', (_zdarzenie, nazwa) => {
    const zapisany = wczytajKlucze()[String(nazwa)];
    if (!zapisany) return null;
    try {
      return safeStorage.decryptString(Buffer.from(zapisany, 'base64'));
    } catch {
      // Plik przeniesiony z innego komputera albo z innego konta Windows.
      return null;
    }
  });

  ipcMain.handle('klucz:zapisz', (_zdarzenie, nazwa, wartosc) => {
    sprawdzSzyfrowanie();
    const klucze = wczytajKlucze();
    klucze[String(nazwa)] = safeStorage.encryptString(String(wartosc)).toString('base64');
    zapiszKlucze(klucze);
    return true;
  });

  ipcMain.handle('klucz:skasuj', (_zdarzenie, nazwa) => {
    const klucze = wczytajKlucze();
    delete klucze[String(nazwa)];
    zapiszKlucze(klucze);
    return true;
  });

  ipcMain.handle('baza:otworz', (_zdarzenie, klucz) => {
    otworzBaze(klucz);
    return true;
  });

  ipcMain.handle('baza:polecenia', (_zdarzenie, sql) => {
    wymagajBazy().exec(String(sql));
    return true;
  });

  ipcMain.handle('baza:pobierz', (_zdarzenie, sql, parametry) => (
    wymagajBazy().prepare(String(sql)).get(...(parametry ?? [])) ?? null
  ));

  ipcMain.handle('baza:wszystkie', (_zdarzenie, sql, parametry) => (
    wymagajBazy().prepare(String(sql)).all(...(parametry ?? []))
  ));

  ipcMain.handle('baza:wykonaj', (_zdarzenie, sql, parametry) => {
    const wynik = wymagajBazy().prepare(String(sql)).run(...(parametry ?? []));
    return {
      changes: wynik.changes,
      lastInsertRowId: Number(wynik.lastInsertRowid ?? 0),
    };
  });

  ipcMain.handle('baza:zamknij', () => { zamknijBaze(); return true; });
  ipcMain.handle('baza:skasuj', () => { skasujPlikBazy(); return true; });
}

/* ===================================================================== */
/*  Okno                                                                  */
/* ===================================================================== */

function utworzOkno() {
  const okno = new BrowserWindow({
    // Interfejs jest zaprojektowany pod waski ekran telefonu (9:16), wiec
    // okno startuje w tych proporcjach zamiast rozlewac sie na caly monitor.
    width: 460,
    height: 880,
    minWidth: 380,
    minHeight: 620,
    show: false,
    title: 'Warsztat',
    backgroundColor: '#F3F5F8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'mostek.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  okno.once('ready-to-show', () => okno.show());

  // Zadnych nowych okien: kazdy adres z zewnatrz otwiera sie w przegladarce
  // systemowej, a nie w oknie, ktore ma dostep do mostu.
  okno.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  okno.webContents.on('will-navigate', (zdarzenie, url) => {
    const dozwolony = url.startsWith(ADRES_EKRANOW)
      || (process.env.WARSZTAT_ADRES_DEV && url.startsWith(process.env.WARSZTAT_ADRES_DEV));
    if (!dozwolony) zdarzenie.preventDefault();
  });

  // Tryb pracy nad interfejsem: ekrany leca prosto z Metro (npm run web),
  // wiec zmiana w kodzie jest widoczna od razu.
  if (process.env.WARSZTAT_ADRES_DEV) {
    okno.loadURL(process.env.WARSZTAT_ADRES_DEV);
  } else {
    // Bez `/index.html` na koncu: expo-router czyta sciezke adresu jako
    // nazwe ekranu i pokazalby "Unmatched Route" zamiast listy klientow.
    okno.loadURL(`${ADRES_EKRANOW}/`);
  }

  return okno;
}

/* ===================================================================== */
/*  Start                                                                 */
/* ===================================================================== */

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEMAT,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

// Jedna instancja na komputer: dwa okna otwieraly by ten sam plik bazy,
// a SQLite trzyma go na wylacznosc.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let glowneOkno = null;

  app.on('second-instance', () => {
    if (!glowneOkno) return;
    if (glowneOkno.isMinimized()) glowneOkno.restore();
    glowneOkno.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    const katalog = katalogEkranow();
    protocol.handle(SCHEMAT, async (zadanie) => {
      const sciezka = new URL(zadanie.url).pathname;
      const plik = path.join(katalog, sciezka === '/' ? 'index.html' : decodeURIComponent(sciezka));

      // Zadna sciezka nie ma prawa wyjsc poza katalog z ekranami.
      const wewnatrz = path.resolve(plik).startsWith(path.resolve(katalog));
      const cel = wewnatrz && fs.existsSync(plik) && fs.statSync(plik).isFile()
        ? plik
        // Expo buduje jedna strone (SPA), wiec kazdy nieznany adres to ten
        // sam index.html - przeladowanie w srodku aplikacji nie ma prawa
        // skonczyc sie pustym oknem.
        : path.join(katalog, 'index.html');

      const odpowiedz = await net.fetch(pathToFileURL(cel).toString());
      const naglowki = new Headers(odpowiedz.headers);
      naglowki.set('Content-Security-Policy', POLITYKA);
      return new Response(odpowiedz.body, { status: odpowiedz.status, headers: naglowki });
    });

    podlaczMost();
    glowneOkno = utworzOkno();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) glowneOkno = utworzOkno();
    });
  });

  app.on('window-all-closed', () => {
    zamknijBaze();
    app.quit();
  });

  app.on('before-quit', zamknijBaze);
}
