/**
 * Bezpieczna pamiec na token urzadzenia, weryfikator hasla i klucz szyfrowania
 * lokalnej bazy.
 *
 * NA TELEFONIE (android / ios) — Keychain / Keystore, z flaga
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: wartosci sa chronione sprzetowo, dostepne
 * dopiero po odblokowaniu telefonu i NIE przenosza sie kopia zapasowa na inne
 * urzadzenie (A4, A12).
 *
 * W PRZEGLADARCE — zwykly localStorage, bo Keychain tam po prostu nie istnieje.
 * To znaczy dokladnie tyle, ze wersja webowa **nie nadaje sie do pracy na
 * prawdziwych danych klientow** i sluzy wylacznie do ogladania interfejsu na
 * localhost. Aplikacja mowi o tym wprost paskiem ostrzegawczym, zamiast udawac,
 * ze jest inaczej — cicha degradacja zabezpieczen bylaby gorsza niz jej brak.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** true = przegladarka: brak Keychain, brak szyfrowania bazy, tryb podgladu. */
export const TRYB_PODGLADU = Platform.OS === 'web';

const OPCJE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const PREFIKS_WEB = 'podglad.';

function magazynWeb(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function czytaj(klucz: string): Promise<string | null> {
  if (TRYB_PODGLADU) return magazynWeb()?.getItem(PREFIKS_WEB + klucz) ?? null;
  return SecureStore.getItemAsync(klucz, OPCJE).catch(() => null);
}

export async function zapisz(klucz: string, wartosc: string): Promise<void> {
  if (TRYB_PODGLADU) {
    magazynWeb()?.setItem(PREFIKS_WEB + klucz, wartosc);
    return;
  }
  await SecureStore.setItemAsync(klucz, wartosc, OPCJE);
}

export async function skasuj(klucz: string): Promise<void> {
  if (TRYB_PODGLADU) {
    magazynWeb()?.removeItem(PREFIKS_WEB + klucz);
    return;
  }
  await SecureStore.deleteItemAsync(klucz, OPCJE).catch(() => undefined);
}
