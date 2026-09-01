/**
 * Kolumna z trescia aplikacji.
 *
 * Interfejs jest zaprojektowany pod WASKA kolumne o proporcjach 9:16 - duze
 * kafelki usterek, jedna rzecz pod druga, wszystko w zasiegu kciuka. Okno
 * programu startuje dokladnie w tych proporcjach, wiec zwykle nic tu sie nie
 * dzieje: tresc dostaje cala szerokosc okna.
 *
 * Dopiero po rozciagnieciu albo zmaksymalizowaniu okna kolumna przestaje
 * rosnac i staje na srodku, na spokojnym tle. Rozlany na caly monitor
 * formularz z jednym polem na linie wygladalby jak rozciagnieta strona
 * internetowa, a nie jak narzedzie pracy.
 */
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Kolory } from '../motyw';
import { cien } from '../motyw';
import { pewneWymiary, szerokoscKolumny } from '../uklad';

export default function KolumnaEkranu({ children }: { children: React.ReactNode }) {
  // pewneWymiary ratuje pierwsze renderowanie na webie, gdzie
  // react-native-web potrafi jeszcze zwracac 0 x 0.
  const { width, height } = pewneWymiary(useWindowDimensions());
  const szerokosc = szerokoscKolumny(width, height);

  // Okno jest wezsze niz 9/16 swojej wysokosci - tresc bierze cala szerokosc.
  if (!(width > 0) || szerokosc >= width) {
    return <View style={style.pelny}>{children}</View>;
  }

  return (
    <View style={style.otoczenie}>
      <View style={[style.kolumna, { width: szerokosc }]}>{children}</View>
    </View>
  );
}

const style = StyleSheet.create({
  pelny: { flex: 1, backgroundColor: Kolory.tlo },
  otoczenie: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Kolory.tloOprawy,
  },
  kolumna: {
    flex: 1,
    backgroundColor: Kolory.tlo,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Kolory.obramowanie,
    ...cien('lekki'),
  },
});
