/**
 * Uklad nawigacji aplikacji (expo-router) plus bramka wejsciowa.
 *
 * Zanim mechanik zobaczy jakiekolwiek dane klientow, aplikacja ustala,
 * w ktorej fazie jest to urzadzenie:
 *
 *   parowanie    - komputer nie ma jeszcze dostepu; pokazuje kod dla administratora
 *   ustaw_haslo  - dostep przyznany; mechanik wybiera wlasne haslo
 *   zablokowana  - haslo jest, trzeba je podac (A5)
 *   gotowa       - normalna praca
 *
 * D1: o fazie decyduje WYLACZNIE zawartosc dysku. Brak sieci nigdy nie
 *     przelaczy mechanika na ekran logowania.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import EkranParowania from '../komponenty/EkranParowania';
import { EkranOdblokowania, EkranUstawieniaHasla } from '../komponenty/EkranBlokady';
import { KomunikatBledu, Ladowanie } from '../komponenty/Stany';
import { AplikacjaProvider, useAplikacja } from '../dane/kontekst';
import { TRYB_PODGLADU } from '../dane/pamiecBezpieczna';
import { Kolory, Odstepy, Typografia, Zaokraglenia } from '../motyw';
import { s } from '../uklad';

/**
 * Serwer swiadomie odmowil wykonania zmiany - dzis jedyny taki przypadek to
 * proba usuniecia zgloszenia przed uplywem 30-dniowej karencji.
 *
 * Aplikacja pokazuje to jako pasek nad cala nawigacja, bo odmowa przychodzi
 * z opoznieniem (po synchronizacji), gdy mechanik jest juz zwykle na innym
 * ekranie. Wizyta zostala w miedzyczasie przywrocona w lokalnej bazie, wiec
 * bez tego komunikatu mechanik zobaczylby tylko, ze "usuniecie samo sie
 * cofnelo" - i slusznie uznalby to za blad aplikacji.
 */
function PasekOdmowy() {
  const { sync, potwierdzOdmowe } = useAplikacja();
  if (!sync.odmowa) return null;

  return (
    <Pressable onPress={potwierdzOdmowe} style={style.odmowa}>
      <Text style={style.odmowaTekst}>{sync.odmowa}</Text>
      <Text style={style.odmowaStopka}>Dotknij, aby ukryc</Text>
    </Pressable>
  );
}

function Bramka() {
  const { faza, bladBazy, sprobujPonownie } = useAplikacja();

  if (faza === 'ladowanie') {
    return (
      <View style={style.pelny}>
        <Ladowanie tekst="Otwieranie danych warsztatu..." />
      </View>
    );
  }

  // Baza sie nie otworzyla. Mowimy o tym wprost - kreciolek bez konca byl
  // gorszy niz jakikolwiek komunikat.
  if (faza === 'brak_bazy') {
    return (
      <View style={style.pelny}>
        <KomunikatBledu
          tytul="Nie udalo sie otworzyc danych"
          tresc={bladBazy ?? 'Nie udalo sie otworzyc lokalnej bazy danych.'}
          tekstPonow={TRYB_PODGLADU ? 'Odswiez strone' : 'Sprobuj ponownie'}
          onPonow={sprobujPonownie}
        />
      </View>
    );
  }

  if (faza === 'parowanie' || faza === 'ustaw_haslo' || faza === 'zablokowana') {
    return (
      <View style={style.pelny}>
        {faza === 'parowanie' ? <EkranParowania /> : null}
        {faza === 'ustaw_haslo' ? <EkranUstawieniaHasla /> : null}
        {faza === 'zablokowana' ? <EkranOdblokowania /> : null}
      </View>
    );
  }

  return (
    <View style={style.pelny}>
      <PasekOdmowy />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Kolory.powierzchnia },
          headerTitleStyle: {
            fontWeight: '800', color: Kolory.tekst, fontSize: Typografia.tytul.fontSize,
          },
          headerTitleAlign: 'center',
          headerTintColor: Kolory.akcent,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: Kolory.tlo },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Klienci' }} />
        <Stack.Screen name="klient/[id]" options={{ title: 'Profil klienta' }} />
        <Stack.Screen name="wizyta/[id]" options={{ title: 'Wizyta' }} />
        <Stack.Screen name="usterki" options={{ title: 'Otwarte usterki' }} />
        <Stack.Screen name="kalendarz" options={{ title: 'Kalendarz' }} />
        {/* Ekran otwiera sie tylko z przycisku widocznego dla administratora,
            a i tak sam sprawdza uprawnienia - podobnie jak serwer. */}
        <Stack.Screen name="administracja" options={{ title: 'Dostep' }} />
        <Stack.Screen
          name="klient/nowy"
          options={{ title: 'Nowy klient', presentation: 'modal' }}
        />
        <Stack.Screen
          name="klient/edytuj"
          options={{ title: 'Edycja klienta', presentation: 'modal' }}
        />
        <Stack.Screen
          name="wizyta/edytuj"
          options={{ title: 'Edycja zgloszenia', presentation: 'modal' }}
        />
        <Stack.Screen
          name="wizyta/nowa"
          options={{ title: 'Nowa wizyta / usterka', presentation: 'modal' }}
        />
        <Stack.Screen
          name="ustawienia"
          options={{ title: 'Aplikacja i synchronizacja', presentation: 'modal' }}
        />
      </Stack>
    </View>
  );
}

export default function UkladGlowny() {
  return (
    <SafeAreaProvider>
      {/* KeyboardProvider musi stac nad cala nawigacja - to on mierzy
          wysokosc klawiatury dla KeyboardAwareScrollView w formularzach. */}
      <KeyboardProvider>
        <AplikacjaProvider>
        <StatusBar style="dark" />
        <Bramka />
        </AplikacjaProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const style = StyleSheet.create({
  pelny: { flex: 1 },
  odmowa: {
    backgroundColor: Kolory.pilneTlo,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.s,
    paddingHorizontal: Odstepy.m,
    paddingVertical: Odstepy.s,
  },
  odmowaTekst: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.blad },
  odmowaStopka: {
    fontSize: s(11), fontWeight: '700', color: Kolory.blad,
    marginTop: 2, opacity: 0.75,
  },
});
