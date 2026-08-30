/**
 * Wystawienie kodu zaproszenia dla nowego warsztatu.
 *
 * To jest jedyny moment, w ktorym dostawca uslugi bierze udzial w zyciu
 * warsztatu. Kod dajesz klientowi przy sprzedazy; pierwsza osoba wpisuje go
 * w aplikacji, co zaklada warsztat i jej konto ADMINISTRATORA. Od tej chwili
 * warsztat radzi sobie sam: administrator przyznaje i odbiera dostep
 * pozostalym mechanikom z poziomu telefonu.
 *
 *   npm run zaproszenie -- "Warsztat u Kowalskiego" "Jan Kowalski"
 *   npm run zaproszenie -- "Warsztat" "Jan Kowalski" --prefiks WK --dni 30
 *
 * Prefiks (1-4 znaki, wielkie litery lub cyfry) trafia do numerow zlecen:
 * WK/2026/0001. Jesli go nie podasz albo bedzie zajety, baza dobierze wolny.
 *
 * To samo mozna zrobic w SQL Editor w panelu Supabase:
 *   select public.utworz_zaproszenie('Nazwa warsztatu', 'Imie Nazwisko', 'WK', 30);
 */
import { SUPABASE_URL, wymagajKonfiguracji } from '../src/config.js';
import { funkcja } from '../src/supabase.js';

function argument(nazwa, domyslna = null) {
  const i = process.argv.indexOf(`--${nazwa}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : domyslna;
}

async function main() {
  const pozycyjne = process.argv.slice(2).filter((a, i, t) =>
    !a.startsWith('--') && !(i > 0 && t[i - 1].startsWith('--')));

  const [nazwaWarsztatu, imie] = pozycyjne;

  if (!nazwaWarsztatu || !imie) {
    console.error('Uzycie:');
    console.error('  npm run zaproszenie -- "Nazwa warsztatu" "Imie Nazwisko"');
    console.error('  npm run zaproszenie -- "Nazwa" "Imie Nazwisko" --prefiks WK --dni 30');
    process.exit(1);
  }

  wymagajKonfiguracji();

  const wynik = await funkcja('utworz_zaproszenie', {
    p_nazwa_warsztatu: nazwaWarsztatu,
    p_imie: imie,
    p_prefiks: argument('prefiks'),
    p_dni_waznosci: Number(argument('dni', '14')),
  });

  if (!wynik?.ok) {
    console.error('Nie udalo sie wystawic zaproszenia:', wynik?.blad ?? 'nieznany blad');
    process.exit(1);
  }

  const wygasa = new Date(wynik.wygasa_o).toLocaleString('pl-PL');

  console.log('');
  console.log('==============================================================');
  console.log(`  KOD ZAPROSZENIA:   ${wynik.kod}`);
  console.log('==============================================================');
  console.log(`  Warsztat      : ${nazwaWarsztatu}`);
  console.log(`  Administrator : ${imie}`);
  console.log(`  Wazny do      : ${wygasa}`);
  console.log(`  Projekt       : ${SUPABASE_URL}`);
  console.log('--------------------------------------------------------------');
  console.log('  Co z tym zrobic (przekaz klientowi):');
  console.log('   1. Zainstaluj aplikacje Warsztat na swoim telefonie.');
  console.log('   2. Otworz ja i dotknij "Mam kod zaproszenia".');
  console.log('   3. Wpisz kod powyzej i ustaw wlasne haslo.');
  console.log('   4. Od tej chwili dodajesz mechanikow sam - ikona klucza');
  console.log('      w lewym gornym rogu listy klientow.');
  console.log('==============================================================');
  console.log('');
  console.log('Kod jest JEDNORAZOWY. Kto go uzyje, zostaje administratorem tego');
  console.log('warsztatu - przekaz go tak, jak przekazujesz haslo.');
}

main().catch((err) => {
  console.error('Blad:', err.message);
  process.exit(1);
});
