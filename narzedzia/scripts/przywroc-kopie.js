/**
 * C1 - odtworzenie kopii zapasowej zrobionej skryptem `npm run kopia`.
 *
 *   npm run przywroc -- kopie/warsztat-2026-08-29-18-00-00.json
 *   npm run przywroc -- kopie/plik.json --na-sucho     (tylko sprawdzenie)
 *
 * Odtwarzanie jest idempotentne: wiersze sa wstawiane przez upsert po kluczu
 * glownym, wiec ponowne uruchomienie niczego nie zdublicuje. Nic nie jest
 * kasowane - skrypt tylko dokłada i nadpisuje.
 *
 * PRZETESTUJ TO NA PUSTYM PROJEKCIE, ZANIM BEDZIE POTRZEBNE.
 */
import fs from 'node:fs';

import { SUPABASE_URL, SERVICE_ROLE_KEY, wymagajKonfiguracji } from '../src/config.js';
import { TABELE } from './kopia-zapasowa.js';

/** Kolumny generowane przez baze - nie da sie ich wstawic wprost. */
const KOLUMNY_GENEROWANE = ['telefon_norm', 'nazwa_norm', 'auto_norm'];

/** Tabele z kluczem `id` generowanym przez baze (identity) - bez upsertu. */
const TABELE_IDENTITY = ['kwarantanna', 'mozliwe_duplikaty', 'dziennik_dostepu', 'dziennik_admina'];

async function wyslij(tabela, wiersze, naSucho) {
  if (!wiersze.length) return 0;

  const oczyszczone = wiersze.map((w) => {
    const kopia = { ...w };
    for (const k of KOLUMNY_GENEROWANE) delete kopia[k];
    if (TABELE_IDENTITY.includes(tabela)) delete kopia.id;
    return kopia;
  });

  if (naSucho) return oczyszczone.length;

  const naRaz = 200;
  let zapisane = 0;
  for (let i = 0; i < oczyszczone.length; i += naRaz) {
    const paczka = oczyszczone.slice(i, i + naRaz);
    const odp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: TABELE_IDENTITY.includes(tabela)
          ? 'return=minimal'
          : 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(paczka),
    });
    if (!odp.ok) {
      throw new Error(`${tabela}: HTTP ${odp.status} ${(await odp.text()).slice(0, 300)}`);
    }
    zapisane += paczka.length;
  }
  return zapisane;
}

async function main() {
  const sciezka = process.argv[2];
  const naSucho = process.argv.includes('--na-sucho');

  if (!sciezka) {
    console.error('Uzycie: npm run przywroc -- <plik-kopii.json> [--na-sucho]');
    process.exit(1);
  }
  wymagajKonfiguracji();

  const kopia = JSON.parse(fs.readFileSync(sciezka, 'utf8'));
  console.log(`Kopia z ${kopia.kiedy}, zrodlo: ${kopia.zrodlo}`);
  console.log(`Cel:    ${SUPABASE_URL}`);
  if (kopia.zrodlo !== SUPABASE_URL) {
    console.log('UWAGA: odtwarzasz do INNEGO projektu niz zrodlowy.');
  }
  console.log(naSucho ? 'Tryb na sucho - nic nie zostanie zapisane.\n' : '');

  for (const tabela of TABELE) {
    const wiersze = kopia.tabele?.[tabela] ?? [];
    process.stdout.write(`  ${tabela.padEnd(20)}`);
    const n = await wyslij(tabela, wiersze, naSucho);
    console.log(`${n} wierszy`);
  }

  console.log('');
  console.log(naSucho ? 'Sprawdzenie zakonczone.' : 'Odtwarzanie zakonczone.');
}

main().catch((err) => {
  console.error('Odtwarzanie NIE POWIODLO SIE:', err.message);
  process.exit(1);
});
