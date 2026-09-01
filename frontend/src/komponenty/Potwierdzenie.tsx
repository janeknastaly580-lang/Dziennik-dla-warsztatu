/**
 * Okno potwierdzenia.
 *
 * Swiadomie NIE korzystamy z `Alert` z React Native: w react-native-web
 * `Alert.alert()` jest pusta funkcja, wiec w przegladarce nie pokazywaloby
 * sie nic i przyciski (np. "Usun zgloszenie") sprawialy wrazenie zepsutych.
 *
 * To okno jest zwyklym nakladanym widokiem. Nie uzywamy tez komponentu
 * `Modal`, bo renderuje sie on poza kolumna tresci.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Przycisk } from './Formularz';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import { s } from '../uklad';

type Props = {
  widoczne: boolean;
  tytul: string;
  tresc?: string;
  /** Napis na przycisku akcji. */
  tekstAkcji?: string;
  /** Gdy pominiete - okno ma tylko jeden przycisk (tryb informacyjny). */
  tekstAnuluj?: string;
  wariant?: 'glowny' | 'niebezpieczny';
  zajety?: boolean;
  onAkcja: () => void;
  onAnuluj: () => void;
};

export default function Potwierdzenie({
  widoczne, tytul, tresc, tekstAkcji = 'OK', tekstAnuluj,
  wariant = 'glowny', zajety, onAkcja, onAnuluj,
}: Props) {
  // Escape zamyka okno - tego odruchu uzywa kazdy program na Windowsie.
  useEffect(() => {
    if (!widoczne || typeof window === 'undefined') return;
    const naKlawisz = (zdarzenie: KeyboardEvent) => {
      if (zdarzenie.key === 'Escape' && !zajety) onAnuluj();
    };
    window.addEventListener('keydown', naKlawisz);
    return () => window.removeEventListener('keydown', naKlawisz);
  }, [widoczne, zajety, onAnuluj]);

  if (!widoczne) return null;

  return (
    <View style={style.warstwa}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={zajety ? undefined : onAnuluj}
        accessibilityLabel="Zamknij okno"
      />
      <View style={style.okno}>
        <Text style={style.tytul}>{tytul}</Text>
        {tresc ? <Text style={style.tresc}>{tresc}</Text> : null}

        <View style={style.przyciski}>
          {tekstAnuluj ? (
            <View style={style.polowa}>
              <Przycisk
                tytul={tekstAnuluj}
                wariant="drugi"
                onPress={onAnuluj}
                wylaczony={zajety}
              />
            </View>
          ) : null}
          <View style={style.polowa}>
            <Przycisk
              tytul={tekstAkcji}
              wariant={wariant}
              onPress={onAkcja}
              zajety={zajety}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const style = StyleSheet.create({
  warstwa: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Odstepy.xl,
    zIndex: 20,
  },
  okno: {
    width: '100%',
    maxWidth: s(360),
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.l,
    padding: Odstepy.l,
    ...cien('mocny'),
  },
  tytul: {
    fontSize: s(18),
    fontWeight: '800',
    color: Kolory.tekst,
  },
  tresc: {
    fontSize: s(14),
    lineHeight: s(20),
    color: Kolory.tekstDrugi,
    marginTop: Odstepy.s,
  },
  przyciski: {
    flexDirection: 'row',
    gap: Odstepy.s,
    marginTop: Odstepy.l,
  },
  polowa: { flex: 1 },
});
