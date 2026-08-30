/**
 * C1 - wlasna kopia zapasowa bazy warsztatu.
 *
 * Supabase robi swoje kopie, ale kopia trzymana u tego samego dostawcy co baza
 * nie chroni przed utrata konta, sporem o platnosc ani pomylka po ich stronie.
 * Ten skrypt zrzuca WSZYSTKIE tabele do jednego pliku JSON na dysku warsztatu,
 * skad mozna go odlozyc gdziekolwiek indziej (dysk zewnetrzny, inna chmura).
 *
 *   npm run kopia
 *
 * Odtworzenie: npm run przywroc -- kopie/warsztat-RRRR-MM-DD.json
 * Kopia nieprzetestowana to nie kopia - przetestuj odtwarzanie ZANIM bedzie
 * potrzebne (patrz DO-ZROBIENIA-RECZNIE.md).
 */
import fs from 'node:fs';
import path from 'node:path';

import { KATALOG_KOPII, SUPABASE_URL, wymagajKonfiguracji } from '../src/config.js';
import { wybierz } from '../src/supabase.js';

/** Kolejnosc ma znaczenie przy odtwarzaniu - rodzice przed dziecmi. */
export const TABELE = [
  'warsztaty', 'mechanicy', 'urzadzenia', 'klienci', 'wizyty',
  'numeratory', 'kwarantanna', 'mozliwe_duplikaty', 'dziennik_dostepu',
  'dziennik_admina', 'operacje',
];

/** PostgREST oddaje maksymalnie 1000 wierszy na raz - pobieramy stronami. */
async function pobierzCalaTabele(tabela) {
  const wszystko = [];
  const strona = 1000;
  for (let offset = 0; ; offset += strona) {
    const czesc = await wybierz(tabela, `select=*&order=id.asc&limit=${strona}&offset=${offset}`);
    wszystko.push(...czesc);
    if (czesc.length < strona) break;
  }
  return wszystko;
}

async function main() {
  wymagajKonfiguracji();

  fs.mkdirSync(KATALOG_KOPII, { recursive: true });

  const kopia = { wersja: 1, zrodlo: SUPABASE_URL, kiedy: new Date().toISOString(), tabele: {} };
  let razem = 0;

  for (const tabela of TABELE) {
    process.stdout.write(`  ${tabela.padEnd(20)}`);
    const wiersze = await pobierzCalaTabele(tabela);
    kopia.tabele[tabela] = wiersze;
    razem += wiersze.length;
    console.log(`${wiersze.length} wierszy`);
  }

  const nazwa = `warsztat-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const sciezka = path.join(KATALOG_KOPII, nazwa);
  fs.writeFileSync(sciezka, JSON.stringify(kopia, null, 1), 'utf8');

  const rozmiar = (fs.statSync(sciezka).size / 1024).toFixed(0);
  console.log('');
  console.log(`Kopia zapisana: ${sciezka}`);
  console.log(`Wierszy razem: ${razem}, rozmiar: ${rozmiar} kB`);
  console.log('');
  console.log('NASTEPNY KROK: skopiuj ten plik POZA ten komputer i poza Supabase.');
  console.log('Kopia obok oryginalu nie jest kopia zapasowa.');
}

main().catch((err) => {
  console.error('Kopia zapasowa NIE POWIODLA SIE:', err.message);
  process.exit(1);
});
