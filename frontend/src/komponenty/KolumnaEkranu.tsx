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
 *
 * WYJATEK: kalendarz. Cztery dni obok siebie to widok tabelaryczny, ktoremu
 * szerokosc sluzy, a nie szkodzi - taki ekran prosi o cale okno hakiem
 * `usePelnaSzerokosc()`. Zwolnienie dziala tylko, dopoki ten ekran jest na
 * wierzchu; wejscie w zgloszenie wraca do waskiej kolumny.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Kolory } from '../motyw';
import { cien } from '../motyw';
import { pewneWymiary, szerokoscKolumny } from '../uklad';

const KontekstKolumny = createContext<(pelna: boolean) => void>(() => undefined);

/** Ekran, ktory ma zajac cale okno, dopoki jest na wierzchu. */
export function usePelnaSzerokosc(): void {
  const ustaw = useContext(KontekstKolumny);
  useFocusEffect(useCallback(() => {
    ustaw(true);
    return () => ustaw(false);
  }, [ustaw]));
}

export default function KolumnaEkranu({ children }: { children: React.ReactNode }) {
  // pewneWymiary ratuje pierwsze renderowanie na webie, gdzie
  // react-native-web potrafi jeszcze zwracac 0 x 0.
  const { width, height } = pewneWymiary(useWindowDimensions());
  const szerokosc = szerokoscKolumny(width, height);
  const [pelna, setPelna] = useState(false);

  // Okno wezsze niz 9/16 swojej wysokosci (albo ekran, ktory poprosil o cale)
  // - tresc bierze pelna szerokosc.
  const zwezona = !pelna && width > 0 && szerokosc < width;

  /*
   * Jedno drzewo w obu przypadkach, zmieniaja sie tylko style. Gdyby
   * zwezenie przelaczalo miedzy dwoma roznymi ukladami, React odmontowywalby
   * przy kazdej zmianie caly ekran - a ten przy montowaniu prosi o pelna
   * szerokosc, wiec kalendarz zapetlalby sie na bialym oknie.
   */
  return (
    <View style={[style.otoczenie, !zwezona && style.otoczeniePelne]}>
      <View style={[style.kolumna, zwezona ? { width: szerokosc } : style.kolumnaPelna]}>
        <KontekstKolumny.Provider value={setPelna}>{children}</KontekstKolumny.Provider>
      </View>
    </View>
  );
}

const style = StyleSheet.create({
  otoczenie: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Kolory.tloOprawy,
  },
  otoczeniePelne: { alignItems: 'stretch', backgroundColor: Kolory.tlo },
  kolumna: {
    flex: 1,
    backgroundColor: Kolory.tlo,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Kolory.obramowanie,
    ...cien('lekki'),
  },
  kolumnaPelna: {
    width: '100%',
    borderLeftWidth: 0,
    borderRightWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
});
