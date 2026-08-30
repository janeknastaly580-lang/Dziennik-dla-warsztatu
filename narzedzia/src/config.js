/**
 * Konfiguracja narzedzi dostawcy uslugi.
 *
 * To NIE JEST serwer. Nic tu nie dziala w tle i nic nie musi byc uruchomione,
 * zeby warsztat pracowal. Caly system to Supabase (baza + funkcje brzegowe)
 * i aplikacja na telefonach mechanikow.
 *
 * Te skrypty odpalasz z reki, kilka razy w zyciu projektu:
 *   - wystawienie kodu zaproszenia dla nowego warsztatu,
 *   - kopia zapasowa poza Supabase i jej odtworzenie,
 *   - skan sekretow w repozytorium,
 *   - jednorazowy import danych ze starej, lokalnej bazy SQLite.
 *
 * A2: klucz service_role omija RLS. Zyje wylacznie w tym pliku .env
 * (jest w .gitignore) oraz w sekretach Edge Functions po stronie Supabase.
 * Nigdy w aplikacji mobilnej, nigdy w repozytorium.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const KATALOG_PROJEKTU = path.resolve(__dirname, '..', '..');
export const KATALOG_NARZEDZI = path.resolve(__dirname, '..');

// Minimalny loader .env (bez dodatkowej zaleznosci).
const sciezkaEnv = path.join(KATALOG_NARZEDZI, '.env');
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

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Katalog na kopie zapasowe robione skryptem `npm run kopia`. */
export const KATALOG_KOPII = process.env.KATALOG_KOPII
  ? path.resolve(process.env.KATALOG_KOPII)
  : path.join(KATALOG_PROJEKTU, 'kopie');

/** Lista brakow w konfiguracji - skrypty sprawdzaja ja przed startem. */
export function brakiKonfiguracji() {
  const braki = [];
  if (!SUPABASE_URL) braki.push('SUPABASE_URL');
  if (!SERVICE_ROLE_KEY) braki.push('SUPABASE_SERVICE_ROLE_KEY');
  return braki;
}

/** Wspolne wyjscie z bledem konfiguracji. */
export function wymagajKonfiguracji() {
  const braki = brakiKonfiguracji();
  if (braki.length) {
    console.error(`Brakuje w narzedzia/.env: ${braki.join(', ')}`);
    console.error('Wzor: narzedzia/.env.example');
    process.exit(1);
  }
}
