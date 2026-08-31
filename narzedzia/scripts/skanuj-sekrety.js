/**
 * A2 - skaner sekretow w repozytorium.
 *
 * Plik .apk i .ipa rozpakowuje sie w kilka minut, a historia gita pamieta
 * wszystko. Ten skrypt szuka kluczy, ktore nigdy nie powinny trafic do
 * repozytorium ani do paczki aplikacji.
 *
 *   npm run skanuj              sprawdza pliki w projekcie
 *   npm run skanuj -- --hook    dodatkowo instaluje hook pre-commit
 *
 * Kod wyjscia 1 = znaleziono cos podejrzanego (hook zablokuje commit).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { KATALOG_PROJEKTU } from '../src/config.js';

const POMIJANE_KATALOGI = new Set([
  'node_modules', '.git', '.expo', 'dist', 'build', 'kopie', '.next', 'android', 'ios',
]);
const POMIJANE_PLIKI = new Set(['package-lock.json', 'yarn.lock', 'skanuj-sekrety.js']);
const ROZSZERZENIA = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.sql', '.yml', '.yaml',
  '.env', '.example', '.html', '.sh', '.ps1', '.txt', '.gradle', '.plist',
]);

const WZORY = [
  {
    nazwa: 'Klucz service_role Supabase (JWT z rola service_role)',
    // JWT, ktorego czesc srodkowa zawiera "service_role" po zdekodowaniu -
    // szukamy tez zapisu jawnego.
    wzor: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    sprawdz: (dopasowanie) => {
      try {
        const czesc = dopasowanie.split('.')[1];
        const json = JSON.parse(Buffer.from(czesc, 'base64url').toString('utf8'));
        return json.role === 'service_role';
      } catch {
        return false;
      }
    },
  },
  { nazwa: 'Klucz secret Supabase (sb_secret_...)', wzor: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { nazwa: 'Haslo do bazy w adresie polaczenia', wzor: /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/g },
  { nazwa: 'Klucz prywatny (PEM)', wzor: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { nazwa: 'Token GitHub', wzor: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { nazwa: 'Klucz AWS', wzor: /AKIA[0-9A-Z]{16}/g },
  {
    nazwa: 'Wypelniony klucz sekretny w pliku .env',
    wzor: /^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DB_PASSWORD)=.+$/gm,
    tylkoWPlikach: /\.env$/,
  },
  {
    // Najgrozniejsza pomylka w tym projekcie: sekret pod prefiksem, ktory
    // Expo wkleja na stale do paczki .apk / .ipa. Taki klucz jest publiczny
    // w chwili zbudowania aplikacji - nawet jesli plik .env nigdy nie trafi
    // do repozytorium. app.config.js lapie to przy buildzie, a skaner tutaj.
    nazwa: 'SEKRET pod prefiksem EXPO_PUBLIC_ (trafilby do paczki .apk!)',
    wzor: /^EXPO_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET|PASSWORD|PRIVATE)[A-Z0-9_]*=.+$/gm,
    // Nie ma znaczenia, czy plik jest w .gitignore - Expo i tak wklei
    // te wartosc do paczki aplikacji przy budowaniu.
    zawszePowazne: true,
  },
];

function* pliki(katalog) {
  for (const wpis of fs.readdirSync(katalog, { withFileTypes: true })) {
    if (wpis.isDirectory()) {
      if (POMIJANE_KATALOGI.has(wpis.name)) continue;
      yield* pliki(path.join(katalog, wpis.name));
    } else {
      if (POMIJANE_PLIKI.has(wpis.name)) continue;
      const ext = path.extname(wpis.name);
      if (ROZSZERZENIA.has(ext) || wpis.name.startsWith('.env')) {
        yield path.join(katalog, wpis.name);
      }
    }
  }
}

/**
 * Czy git faktycznie pominie ten plik?
 *
 * Pytamy o to samego gita zamiast powtarzac reguly z .gitignore w drugim
 * miejscu - inaczej skaner zaczalby klamac przy pierwszej zmianie regul.
 * `frontend/.env` jest celowym wyjatkiem od reguly `.env`: trzyma wylacznie
 * klucze publiczne EXPO_PUBLIC_* i JEST sledzony, wiec sekret w nim to
 * prawdziwy wyciek.
 */
function ignorowanePrzezGita(wzgledna) {
  try {
    // exit 0 = plik jest ignorowany, exit 1 = trafi do repozytorium
    execFileSync('git', ['check-ignore', '-q', wzgledna], {
      cwd: KATALOG_PROJEKTU, stdio: 'ignore',
    });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    // Brak gita albo brak repozytorium - zakladamy najgorsze, czyli ze plik
    // trafi do repozytorium. Lepiej falszywy alarm niz przeoczony sekret.
    const znormalizowana = wzgledna.replace(/\\/g, '/');
    return znormalizowana === 'narzedzia/.env' || znormalizowana.startsWith('kopie/');
  }
}

function skanuj() {
  const znalezione = [];

  for (const plik of pliki(KATALOG_PROJEKTU)) {
    const wzgledna = path.relative(KATALOG_PROJEKTU, plik);
    const wIgnorze = ignorowanePrzezGita(wzgledna);
    const tresc = fs.readFileSync(plik, 'utf8');

    for (const { nazwa, wzor, sprawdz, tylkoWPlikach, zawszePowazne } of WZORY) {
      if (tylkoWPlikach && !tylkoWPlikach.test(wzgledna)) continue;
      wzor.lastIndex = 0;
      for (const dopasowanie of tresc.matchAll(wzor)) {
        if (sprawdz && !sprawdz(dopasowanie[0])) continue;
        const linia = tresc.slice(0, dopasowanie.index).split('\n').length;
        znalezione.push({ plik: wzgledna, linia, nazwa, wIgnorze: wIgnorze && !zawszePowazne });
      }
    }
  }
  return znalezione;
}

function zainstalujHook() {
  const katalogGit = path.join(KATALOG_PROJEKTU, '.git');
  if (!fs.existsSync(katalogGit)) {
    console.log('To nie jest repozytorium gita - hook pominiety.');
    console.log('Zaloz repozytorium (git init) i uruchom ponownie z --hook.');
    return;
  }
  const katalogHookow = path.join(katalogGit, 'hooks');
  fs.mkdirSync(katalogHookow, { recursive: true });
  const sciezka = path.join(katalogHookow, 'pre-commit');
  fs.writeFileSync(sciezka, [
    '#!/bin/sh',
    '# A2: blokada commita z sekretem w tresci.',
    'node narzedzia/scripts/skanuj-sekrety.js || {',
    '  echo ""',
    '  echo "COMMIT ZATRZYMANY: w plikach jest sekret."',
    '  echo "Usun go, a jesli juz gdzies wyciekl - ZROTUJ klucz w Supabase."',
    '  exit 1',
    '}',
    '',
  ].join('\n'), { mode: 0o755 });
  console.log(`Hook zainstalowany: ${sciezka}`);
}

const znalezione = skanuj();
const powazne = znalezione.filter((z) => !z.wIgnorze);

if (znalezione.length === 0) {
  console.log('Skaner sekretow: czysto.');
} else {
  for (const z of znalezione) {
    const oznaczenie = z.wIgnorze ? '  (w .gitignore, poza repozytorium)' : '  <-- DO USUNIECIA';
    console.log(`${z.plik}:${z.linia}  ${z.nazwa}${oznaczenie}`);
  }
  console.log('');
  if (powazne.length) {
    console.log(`Znaleziono ${powazne.length} sekretow w plikach, ktore moga trafic do repozytorium.`);
    console.log('Jesli ktorykolwiek z nich juz gdzies wyciekl - ZROTUJ go, nie zakladaj,');
    console.log('ze "raczej nikt nie zauwazyl".');
  } else {
    console.log('Wszystkie znaleziska sa w plikach wykluczonych z repozytorium - to w porzadku.');
  }
}

if (process.argv.includes('--hook')) zainstalujHook();

process.exit(powazne.length ? 1 : 0);
