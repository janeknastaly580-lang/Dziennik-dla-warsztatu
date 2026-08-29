/**
 * Konfiguracja panelu administratora.
 *
 * A2 - KLUCZOWA ZASADA TEGO PLIKU:
 * `SUPABASE_SERVICE_ROLE_KEY` omija RLS i daje pelny dostep do bazy. Zyje
 * wylacznie tutaj, na komputerze w warsztacie, w pliku backend/.env, ktory
 * jest w .gitignore. Nigdy nie trafia do aplikacji mobilnej ani do repozytorium.
 *
 * Panel nasluchuje domyslnie na 127.0.0.1 - jest widoczny TYLKO z tego
 * komputera. To celowe: gdyby wisial na 0.0.0.0, kazdy w sieci Wi-Fi
 * warsztatu probowalby sie do niego dobrac, a za nim stoi klucz omijajacy
 * wszystkie zabezpieczenia bazy.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const KATALOG_PROJEKTU = path.resolve(__dirname, '..', '..');
export const KATALOG_BACKENDU = path.resolve(__dirname, '..');
export const KATALOG_PUBLICZNY = path.join(__dirname, 'publiczne');

// Minimalny loader .env (bez dodatkowej zaleznosci).
const sciezkaEnv = path.join(KATALOG_BACKENDU, '.env');
if (fs.existsSync(sciezkaEnv)) {
  for (const linia of fs.readFileSync(sciezkaEnv, 'utf8').split(/\r?\n/)) {
    const t = linia.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const klucz = t.slice(0, i).trim();
    const wartosc = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(klucz in process.env)) process.env[klucz] = wartosc;
  }
}

export const PORT = Number(process.env.PORT || 4000);
/** 127.0.0.1 = panel dostepny wylacznie z tego komputera (patrz naglowek). */
export const HOST = process.env.HOST || '127.0.0.1';

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const HASLO_PANELU = process.env.HASLO_PANELU || '';
export const NAZWA_ADMINISTRATORA = process.env.NAZWA_ADMINISTRATORA || 'administrator';

/** Katalog na kopie zapasowe robione skryptem `npm run kopia`. */
export const KATALOG_KOPII = process.env.KATALOG_KOPII
  ? path.resolve(process.env.KATALOG_KOPII)
  : path.join(KATALOG_PROJEKTU, 'kopie');

/** Lista brakow w konfiguracji - serwer wypisuje ja przy starcie. */
export function brakiKonfiguracji() {
  const braki = [];
  if (!SUPABASE_URL) braki.push('SUPABASE_URL');
  if (!SERVICE_ROLE_KEY) braki.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!HASLO_PANELU) braki.push('HASLO_PANELU');
  return braki;
}
