/**
 * Wspolna oprawa kazdego formularza w aplikacji.
 *
 * PROBLEM, KTORY ROZWIAZUJE: na Androidzie klawiatura zasłaniala dolne pola.
 * `KeyboardAvoidingView` z gołego React Native radzi sobie z tym slabo, gdy
 * ekran jest przewijany i ma kilka pol - a wszystkie formularze warsztatu
 * takie wlasnie sa (klient ma szesc pol, wizyta cztery).
 *
 * `KeyboardAwareScrollView` z `react-native-keyboard-controller`:
 *   - podnosi zawartosc dokladnie o wysokosc klawiatury,
 *   - PRZEWIJA do pola, ktore wlasnie dostalo kursor, zeby bylo widoczne,
 *   - zostawia ekran normalnie przewijalny palcem,
 *   - animuje sie rownolegle z klawiatura, wiec nie ma przeskoku.
 *
 * Biblioteka jest w Expo SDK 54+ dostepna takze w Expo Go, ale wymaga
 * `KeyboardProvider` na samej gorze drzewa - jest w `app/_layout.tsx`.
 *
 * `bottomOffset` to zapas pod aktywnym polem: bez niego pole ląduje tuz przy
 * krawedzi klawiatury i nie widac ani etykiety bledu, ani przycisku.
 */
import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Kolory, Odstepy } from '../motyw';
import { s, wys } from '../uklad';

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
    // Zapas na dole - ostatni przycisk nie chowa sie pod paskiem gestow.
    paddingBottom: wys(10, 48),
  },
});
