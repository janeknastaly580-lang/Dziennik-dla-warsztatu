/**
 * Pole wyszukiwania nad lista klientow.
 *
 * Samo pole tylko zbiera tekst - filtrowanie odbywa sie natychmiast
 * w komponencie listy, na juz pobranych danych (filtr "na zywo",
 * bez zapytania do serwera przy kazdej literze).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import { CEL_DOTYKU, s } from '../uklad';

type Props = {
  wartosc: string;
  onZmiana: (tekst: string) => void;
  placeholder?: string;
};

export default function PoleWyszukiwania({ wartosc, onZmiana, placeholder }: Props) {
  return (
    <View style={style.ramka}>
      <Text style={style.ikona}>{'⌕'}</Text>
      <TextInput
        style={style.pole}
        value={wartosc}
        onChangeText={onZmiana}
        placeholder={placeholder ?? 'Szukaj: nazwisko, telefon, nr rejestracyjny...'}
        placeholderTextColor={Kolory.tekstSlaby}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        returnKeyType="search"
      />
      {wartosc.length > 0 ? (
        <Pressable
          onPress={() => onZmiana('')}
          hitSlop={12}
          accessibilityLabel="Wyczysc wyszukiwanie"
          style={style.czysc}
        >
          <Text style={style.czyscTekst}>{'×'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const style = StyleSheet.create({
  ramka: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.m,
    paddingHorizontal: Odstepy.m,
    height: Math.max(CEL_DOTYKU + s(6), s(50)),
    ...cien('lekki'),
  },
  ikona: {
    fontSize: s(18),
    color: Kolory.tekstSlaby,
    marginRight: Odstepy.s,
  },
  pole: {
    flex: 1,
    fontSize: s(16),
    color: Kolory.tekst,
    padding: 0,
  },
  czysc: {
    width: s(26),
    height: s(26),
    borderRadius: Zaokraglenia.pelne,
    backgroundColor: Kolory.powierzchniaStonowana,
    alignItems: 'center',
    justifyContent: 'center',
  },
  czyscTekst: {
    fontSize: s(17),
    lineHeight: s(20),
    color: Kolory.tekstDrugi,
  },
});
