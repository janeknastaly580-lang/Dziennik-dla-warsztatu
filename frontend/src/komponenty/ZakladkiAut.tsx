/**
 * Zakladki nad historia wizyt w profilu klienta.
 *
 * Auta nie sa osobnymi rekordami - zakladki powstaja z unikalnych opisow
 * wpisanych przy wizytach. Pierwsza zakladka ("Wszystkie") jest domyslnie
 * aktywna i pokazuje historie ze wszystkich aut klienta.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Kolory, Odstepy, Zaokraglenia } from '../motyw';
import { CEL_DOTYKU, s } from '../uklad';
import { etykietaAuta } from '../format';
import type { Auto } from '../typy';

type Props = {
  auta: Auto[];
  /** null = wszystkie auta */
  wybrane: string | null;
  onWybor: (auto: string | null) => void;
  liczbaWszystkich: number;
};

export default function ZakladkiAut({ auta, wybrane, onWybor, liczbaWszystkich }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={style.pasek}
    >
      <Zakladka
        etykieta="Wszystkie"
        licznik={liczbaWszystkich}
        aktywna={wybrane === null}
        onPress={() => onWybor(null)}
      />
      {auta.map((a) => (
        <Zakladka
          key={a.auto}
          etykieta={etykietaAuta(a.auto)}
          licznik={a.liczba_wizyt}
          alarm={a.liczba_otwartych > 0}
          aktywna={wybrane === a.auto}
          onPress={() => onWybor(a.auto)}
        />
      ))}
    </ScrollView>
  );
}

function Zakladka({
  etykieta, licznik, aktywna, alarm, onPress,
}: {
  etykieta: string;
  licznik: number;
  aktywna: boolean;
  alarm?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: aktywna }}
      style={[style.zakladka, aktywna && style.zakladkaAktywna]}
    >
      <View style={style.wiersz}>
        {alarm ? <View style={style.kropka} /> : null}
        <Text style={[style.etykieta, aktywna && style.etykietaAktywna]} numberOfLines={1}>
          {etykieta}
        </Text>
        <View style={[style.licznik, aktywna && style.licznikAktywny]}>
          <Text style={[style.licznikTekst, aktywna && style.licznikTekstAktywny]}>
            {licznik}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const style = StyleSheet.create({
  pasek: {
    gap: Odstepy.s,
    paddingVertical: Odstepy.xs,
    paddingRight: Odstepy.l,
  },
  zakladka: {
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.pelne,
    paddingVertical: s(9),
    paddingHorizontal: Odstepy.m,
    // Na waskim ekranie zakladka nie moze zjesc calej szerokosci.
    maxWidth: s(200),
    minHeight: CEL_DOTYKU,
    justifyContent: 'center',
  },
  zakladkaAktywna: {
    backgroundColor: Kolory.akcent,
    borderColor: Kolory.akcent,
  },
  wiersz: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  kropka: {
    width: s(7),
    height: s(7),
    borderRadius: Zaokraglenia.pelne,
    backgroundColor: Kolory.pilne,
  },
  etykieta: { fontSize: s(14), fontWeight: '700', color: Kolory.tekstDrugi, flexShrink: 1 },
  etykietaAktywna: { color: Kolory.tekstNaAkcencie },
  licznik: {
    minWidth: s(22),
    alignItems: 'center',
    backgroundColor: Kolory.powierzchniaStonowana,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  licznikAktywny: { backgroundColor: 'rgba(255,255,255,0.25)' },
  licznikTekst: { fontSize: s(11), fontWeight: '800', color: Kolory.tekstSlaby },
  licznikTekstAktywny: { color: Kolory.tekstNaAkcencie },
});
