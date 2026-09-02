/**
 * Wspolna oprawa kazdego formularza w aplikacji.
 *
 * PROBLEM, KTORY ROZWIAZUJE: formularz ma byc przewijalny i sam dosuwac do
 * widoku pole, ktore wlasnie dostalo kursor - a wszystkie formularze warsztatu
 * sa dlugie (klient ma szesc pol, wizyta piec). Na komputerze z klawiatura
 * ekranowa (laptop 2w1, tablet z Windows) dziala tez to, po co ta biblioteka
 * powstala: tresc podnosi sie o wysokosc klawiatury.
 *
 * `KeyboardAwareScrollView` z `react-native-keyboard-controller`:
 *   - podnosi zawartosc dokladnie o wysokosc klawiatury,
 *   - PRZEWIJA do pola, ktore wlasnie dostalo kursor, zeby bylo widoczne,
 *   - zostawia ekran normalnie przewijalny palcem,
 *   - animuje sie rownolegle z klawiatura, wiec nie ma przeskoku.
 *
 * Biblioteka wymaga `KeyboardProvider` na samej gorze drzewa - jest
 * w `app/_layout.tsx`.
 *
 * `bottomOffset` to zapas pod aktywnym polem: bez niego pole ląduje tuz przy
 * krawedzi klawiatury i nie widac ani etykiety bledu, ani przycisku.
 */
import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Kolory, Odstepy } from '../motyw';
import { SZEROKOSC_FORMULARZA, s, wys } from '../uklad';

export default function EkranFormularza({
  children,
  styl,
}: {
  children: React.ReactNode;
  styl?: ViewStyle;
}) {
  return (
    <KeyboardAwareScrollView
      style={style.ekran}
      contentContainerStyle={[style.tresc, styl]}
      // Dotkniecie przycisku przy otwartej klawiaturze ma go nacisnac,
      // a nie tylko schowac klawiature.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={s(90)}
      showsVerticalScrollIndicator
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  tresc: {
    padding: Odstepy.l,
    // Zapas na dole - ostatni przycisk nie klei sie do krawedzi okna.
    paddingBottom: wys(10, 48),
    // Pole tekstowe szerokie na caly monitor wyglada jak blad, a nie jak
    // pole - formularz zostaje waski i staje na srodku okna.
    width: '100%',
    maxWidth: SZEROKOSC_FORMULARZA,
    alignSelf: 'center',
  },
});
