/**
 * Sesja urzadzenia i blokada aplikacji.
 *
 * JAK MECHANIK WCHODZI DO APLIKACJI
 *  1. Pierwsze uruchomienie: aplikacja pokazuje osmioznakowy KOD.
 *     Mechanik podaje go administratorowi (telefonicznie, SMS-em, jakkolwiek).
 *  2. Administrator w panelu przypisuje ten kod do konkretnego mechanika.
 *     To jest ten "zdalny, jednorazowy dostep bez hasla" - mechanik nie
 *     wpisuje zadnego hasla do systemu, bo takiego hasla po prostu nie ma.
 *  3. Telefon odbiera token urzadzenia i prosi mechanika o ustawienie
 *     DOWOLNEGO wlasnego hasla. Moze byc krotkie - to blokada aplikacji,
 *     a nie haslo do bazy.
 *  4. Od tej pory mechanik wchodzi tym haslem albo odciskiem palca.
 *  5. Administrator moze w kazdej chwili odebrac dostep albo kazac ustawic
 *     nowe haslo - jednym przyciskiem w panelu.
 *
 * D1 - Token urzadzenia NIE MA daty waznosci i nie jest odswiezany.
 *      Brak sieci nie moze nikogo wylogowac. Sesje uniewaznia wylacznie
 *      administrator.
 * A4 - Token i weryfikator hasla leza w Keychain / Keystore, oznaczone jako
 *      "tylko to urzadzenie" - nie da sie ich przeniesc kopia zapasowa.
 * A5 - Aplikacja blokuje sie sama po 5 minutach bezczynnosci i po przejsciu
 *      w tlo. Nie polegamy na blokadzie systemowej telefonu.
 */
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

import { czytaj, skasuj, zapisz } from './pamiecBezpieczna';

import { MAKS_PROB_HASLA } from './konfiguracja';
import { pobierzMeta, skasujKluczBazy, ustawMeta, wyczyscDaneWarsztatu } from './baza';

const K_TOKEN = 'warsztat_token';
const K_URZADZENIE = 'warsztat_urzadzenie';
const K_ZGLOSZENIE = 'warsztat_zgloszenie';
const K_SOL = 'warsztat_haslo_sol';
const K_WERYFIKATOR = 'warsztat_haslo_weryfikator';
const K_PROBY = 'warsztat_proby';

/* ---------------------------- token urzadzenia -------------------------- */

export type ZgloszenieParowania = {
  id: string;
  sekret: string;
  kod: string;
  wygasa_o: string;
  /** Imie i nazwisko podane przez mechanika - pokazujemy je na ekranie
   *  oczekiwania, zeby mogl sprawdzic, ze nie ma literowki. */
  imie?: string;
};

export const pobierzToken = () => czytaj(K_TOKEN);
export const pobierzIdUrzadzenia = () => czytaj(K_URZADZENIE);

export async function zapiszZgloszenie(z: ZgloszenieParowania): Promise<void> {
  await zapisz(K_ZGLOSZENIE, JSON.stringify(z));
}

export async function pobierzZgloszenie(): Promise<ZgloszenieParowania | null> {
  const t = await czytaj(K_ZGLOSZENIE);
  if (!t) return null;
  try {
    return JSON.parse(t) as ZgloszenieParowania;
  } catch {
    return null;
  }
}

/** Zapisuje wydany token i dane warsztatu. Zgloszenie parowania juz zbedne. */
export async function zapiszDostep(dane: {
  token: string;
  urzadzenie_id: string;
  mechanik: { id: string; imie: string; rola?: string };
  warsztat: { id: string; nazwa: string; prefiks: string; okno_dni: number;
              wygasniecie_offline_dni: number };
}): Promise<void> {
  await zapisz(K_TOKEN, dane.token);
  await zapisz(K_URZADZENIE, dane.urzadzenie_id);
  await skasuj(K_ZGLOSZENIE);

  await ustawMeta('mechanik_id', dane.mechanik.id);
  await ustawMeta('mechanik_imie', dane.mechanik.imie);
  // Rola decyduje o tym, czy telefon pokaze ekran zarzadzania dostepem.
  // Jest odswiezana przy kazdej synchronizacji, wiec odebranie uprawnien
  // administratora dziala od razu.
  await ustawMeta('rola', dane.mechanik.rola ?? 'mechanik');
  await ustawMeta('warsztat_id', dane.warsztat.id);
  await ustawMeta('warsztat_nazwa', dane.warsztat.nazwa);
  await ustawMeta('warsztat_prefiks', dane.warsztat.prefiks);
  await ustawMeta('okno_dni', String(dane.warsztat.okno_dni));
  await ustawMeta('wygasniecie_offline_dni', String(dane.warsztat.wygasniecie_offline_dni));
}

export async function daneMechanika() {
  return {
    mechanik: await pobierzMeta('mechanik_imie'),
    warsztat: await pobierzMeta('warsztat_nazwa'),
    rola: (await pobierzMeta('rola')) ?? 'mechanik',
  };
}

/* -------------------------------- haslo -------------------------------- */

/**
 * Weryfikator hasla liczony lancuchem SHA-256 z 32-bajtowa sola.
 *
 * Dlaczego to wystarcza: weryfikator nigdy nie opuszcza Keychain/Keystore,
 * a wiec zeby go zaatakowac, trzeba juz miec zlamany telefon. Liczba prob
 * jest ograniczona - po MAKS_PROB_HASLA nieudanych probach aplikacja kasuje
 * cala lokalna baze. Haslo nie chroni bazy w chmurze - tam dziala token
 * urzadzenia, ktory administrator moze uniewaznic z panelu.
 */
const RUNDY = 500;

async function policzWeryfikator(haslo: string, sol: string): Promise<string> {
  let wartosc = `${sol}:${haslo}`;
  for (let i = 0; i < RUNDY; i += 1) {
    wartosc = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, wartosc);
  }
  return wartosc;
}

export async function czyHasloUstawione(): Promise<boolean> {
  return (await czytaj(K_WERYFIKATOR)) !== null;
}

/** Mechanik ustawia DOWOLNE haslo - jedyny warunek to niepusty tekst. */
export async function ustawHaslo(haslo: string): Promise<void> {
  const czyste = haslo.trim();
  if (!czyste) throw new Error('Haslo nie moze byc puste.');
  const sol = Array.from(Crypto.getRandomBytes(32))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  await zapisz(K_SOL, sol);
  await zapisz(K_WERYFIKATOR, await policzWeryfikator(czyste, sol));
  await zapisz(K_PROBY, '0');
}

export type WynikSprawdzenia =
  | { ok: true }
  | { ok: false; pozostalo: number }
  | { ok: false; wyczyszczono: true };

export async function sprawdzHaslo(haslo: string): Promise<WynikSprawdzenia> {
  const sol = await czytaj(K_SOL);
  const oczekiwany = await czytaj(K_WERYFIKATOR);
  if (!sol || !oczekiwany) return { ok: true }; // haslo jeszcze nie ustawione

  if ((await policzWeryfikator(haslo.trim(), sol)) === oczekiwany) {
    await zapisz(K_PROBY, '0');
    return { ok: true };
  }

  const proby = Number((await czytaj(K_PROBY)) ?? '0') + 1;
  await zapisz(K_PROBY, String(proby));

  if (proby >= MAKS_PROB_HASLA) {
    await wyczyscWszystko();
    return { ok: false, wyczyszczono: true };
  }
  return { ok: false, pozostalo: MAKS_PROB_HASLA - proby };
}

export async function pozostaleProby(): Promise<number> {
  const proby = Number((await czytaj(K_PROBY)) ?? '0');
  return Math.max(0, MAKS_PROB_HASLA - proby);
}

/* ------------------------------ biometria ------------------------------ */

export async function biometriaDostepna(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync())
      && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function odblokujBiometria(): Promise<boolean> {
  try {
    const wynik = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Odblokuj aplikacje warsztatu',
      cancelLabel: 'Uzyj hasla',
      disableDeviceFallback: false,
    });
    return wynik.success;
  } catch {
    return false;
  }
}

/* ------------------------------ czyszczenie ---------------------------- */

/**
 * A4 / A6 - usuwa z telefonu wszystko: token, haslo i cala lokalna baze.
 * Po tym aplikacja wraca do ekranu parowania.
 */
export async function wyczyscWszystko(): Promise<void> {
  await Promise.all([
    skasuj(K_TOKEN), skasuj(K_URZADZENIE), skasuj(K_ZGLOSZENIE),
    skasuj(K_SOL), skasuj(K_WERYFIKATOR), skasuj(K_PROBY),
  ]);
  await wyczyscDaneWarsztatu();
  // A4: bez klucza pozostalosci pliku bazy na dysku sa juz tylko szyfrogramem.
  await skasujKluczBazy();
}
