/**
 * Bezpieczna pamiec na token urzadzenia, weryfikator hasla i klucz szyfrowania
 * lokalnej bazy.
 *
 * W PROGRAMIE NA WINDOWS — wartosci leza w pliku `klucze.json` w katalogu
 * danych aplikacji, kazda zaszyfrowana przez DPAPI (`safeStorage` Electrona).
 * Odszyfrowuje je wylacznie to konto Windows na tym komputerze: skopiowanie
 * pliku na inny komputer albo na konto kolegi daje szyfrogram (A4).
 * Kryptografia siedzi w procesie glownym — ekrany nigdy nie widza ani klucza
 * DPAPI, ani pliku.
 *
 * W PRZEGLADARCE (`npm run web`) — zwykly localStorage, bo DPAPI tam nie
 * istnieje. To znaczy dokladnie tyle, ze wersja przegladarkowa **nie nadaje
 * sie do pracy na prawdziwych danych klientow** i sluzy wylacznie do
 * ogladania interfejsu na localhost. Aplikacja mowi o tym wprost paskiem
 * ostrzegawczym, zamiast udawac, ze jest inaczej — cicha degradacja
 * zabezpieczen bylaby gorsza niz jej brak.
 */
import { MOST, NA_WINDOWS } from './mostWindows';

/** true = przegladarka: brak DPAPI, brak szyfrowania bazy, tryb podgladu. */
export const TRYB_PODGLADU = !NA_WINDOWS;

const PREFIKS_WEB = 'podglad.';

function magazynWeb(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function czytaj(klucz: string): Promise<string | null> {
  if (!MOST) return magazynWeb()?.getItem(PREFIKS_WEB + klucz) ?? null;
  return MOST.klucz.czytaj(klucz).catch(() => null);
}

export async function zapisz(klucz: string, wartosc: string): Promise<void> {
  if (!MOST) {
    magazynWeb()?.setItem(PREFIKS_WEB + klucz, wartosc);
    return;
  }
  await MOST.klucz.zapisz(klucz, wartosc);
}

export async function skasuj(klucz: string): Promise<void> {
  if (!MOST) {
    magazynWeb()?.removeItem(PREFIKS_WEB + klucz);
    return;
  }
  await MOST.klucz.skasuj(klucz).catch(() => undefined);
}
