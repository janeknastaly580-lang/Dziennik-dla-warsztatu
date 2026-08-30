/**
 * Przeniesienie danych ze starej, lokalnej bazy SQLite (dane/warsztat.db)
 * do Supabase. Uruchamia sie RAZ, przy przejsciu na nowa wersje systemu.
 *
 *   npm run migruj                       podglad, nic nie zapisuje
 *   npm run migruj -- --zapisz           faktyczny przenos
 *   npm run migruj -- --zapisz --warsztat W1
 *
 * Czego skrypt NIE przenosi: zalacznikow i zdjec. Nowy system swiadomie
 * nie przechowuje zdjec - ani w bazie, ani w magazynie plikow. Pliki z
 * katalogu dane/pliki zostaja na dysku warsztatu; skrypt tylko o nich
 * przypomina.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { KATALOG_PROJEKTU, SUPABASE_URL, SERVICE_ROLE_KEY, wymagajKonfiguracji } from '../src/config.js';
import { wybierz } from '../src/supabase.js';

const SCIEZKA_STAREJ_BAZY = path.join(KATALOG_PROJEKTU, 'dane', 'warsztat.db');

async function wstawPaczkami(tabela, wiersze) {
  const naRaz = 200;
  for (let i = 0; i < wiersze.length; i += naRaz) {
    const odp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(wiersze.slice(i, i + naRaz)),
    });
    if (!odp.ok) {
      throw new Error(`${tabela}: HTTP ${odp.status} ${(await odp.text()).slice(0, 400)}`);
    }
  }
}

/** '2026-08-12 14:30:00' (czas lokalny SQLite) -> ISO z Twoja strefa. */
function naIso(wartosc, zapasowa) {
  if (!wartosc) return zapasowa;
  const t = String(wartosc).trim().replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`);
  return Number.isNaN(d.getTime()) ? zapasowa : d.toISOString();
}

async function main() {
  const zapisz = process.argv.includes('--zapisz');
  const iPrefiks = process.argv.indexOf('--warsztat');
  const prefiks = iPrefiks > -1 ? process.argv[iPrefiks + 1] : 'W1';

  wymagajKonfiguracji();
  if (!fs.existsSync(SCIEZKA_STAREJ_BAZY)) {
    console.log(`Nie ma starej bazy (${SCIEZKA_STAREJ_BAZY}) - nie ma czego przenosic.`);
    return;
  }

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    console.error('Brakuje paczki better-sqlite3. Uruchom: cd narzedzia && npm install');
    process.exit(1);
  }

  const [warsztat] = await wybierz('warsztaty', `prefiks=eq.${prefiks}&select=id,nazwa`);
  if (!warsztat) {
    console.error(`Nie ma warsztatu o prefiksie ${prefiks}. Zaloz go w panelu administratora.`);
    process.exit(1);
  }

  const stara = new Database(SCIEZKA_STAREJ_BAZY, { readonly: true });
  const starzyKlienci = stara.prepare('SELECT * FROM klienci').all();
  const stareWizyty = stara.prepare('SELECT * FROM wizyty').all();
  let liczbaPlikow = 0;
  try {
    liczbaPlikow = stara.prepare('SELECT COUNT(*) AS n FROM pliki').get().n;
  } catch { /* starsza baza mogla nie miec tej tabeli */ }
  stara.close();

  // Stary klucz liczbowy -> nowy UUID (B5: klucze glowne sa UUID).
  const idKlienta = new Map(starzyKlienci.map((k) => [k.id, crypto.randomUUID()]));

  const teraz = new Date().toISOString();
  const klienci = starzyKlienci.map((k) => ({
    id: idKlienta.get(k.id),
    warsztat_id: warsztat.id,
    nazwa: k.nazwa,
    telefon: k.telefon, email: k.email, adres: k.adres, nip: k.nip, notatki: k.notatki,
    utworzono: naIso(k.utworzono, teraz),
    zrobione_o: naIso(k.utworzono, teraz),
  }));

  const wizyty = stareWizyty
    .filter((w) => idKlienta.has(w.klient_id))
    .map((w) => ({
      id: crypto.randomUUID(),
      warsztat_id: warsztat.id,
      klient_id: idKlienta.get(w.klient_id),
      auto: w.auto, tytul: w.tytul, opis: w.opis,
      status: w.status, priorytet: w.priorytet,
      data_wizyty: w.data_wizyty, data_zamkniecia: w.data_zamkniecia,
      przebieg: w.przebieg, koszt: w.koszt,
      utworzono: naIso(w.utworzono, teraz),
      zrobione_o: naIso(w.utworzono, teraz),
    }));

  const osierocone = stareWizyty.length - wizyty.length;

  console.log(`Stara baza : ${SCIEZKA_STAREJ_BAZY}`);
  console.log(`Warsztat   : ${warsztat.nazwa} (${prefiks})`);
  console.log(`Klienci    : ${klienci.length}`);
  console.log(`Wizyty     : ${wizyty.length}${osierocone ? ` (pominieto ${osierocone} bez klienta)` : ''}`);
  console.log(`Zalaczniki : ${liczbaPlikow} - NIE sa przenoszone (system nie przechowuje zdjec)`);
  console.log('');

  if (!zapisz) {
    console.log('To byl podglad. Zeby faktycznie przeniesc dane:');
    console.log(`  npm run migruj -- --zapisz --warsztat ${prefiks}`);
    return;
  }

  await wstawPaczkami('klienci', klienci);
  console.log(`Zapisano klientow: ${klienci.length}`);
  await wstawPaczkami('wizyty', wizyty);
  console.log(`Zapisano wizyt: ${wizyty.length}`);

  console.log('');
  console.log('Gotowe. Stara baza NIE zostala ruszona - lezy dalej w dane/warsztat.db.');
  if (liczbaPlikow > 0) {
    console.log(`Uwaga: w dane/pliki lezy ${liczbaPlikow} zalacznikow. Nowy system ich nie uzywa.`);
    console.log('Jesli sa niepotrzebne - skasuj je. Zdjecia aut to dane osobowe (tablice,');
    console.log('wizerunki osob w tle) i trzymanie ich "na wszelki wypadek" jest ryzykiem.');
  }
}

main().catch((err) => {
  console.error('Migracja NIE POWIODLA SIE:', err.message);
  process.exit(1);
});
