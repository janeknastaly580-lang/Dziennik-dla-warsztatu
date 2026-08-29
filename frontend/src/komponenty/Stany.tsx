/** Powtarzalne stany ekranu: ladowanie, blad, brak danych. */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Kolory, Odstepy, Typografia, Zaokraglenia } from '../motyw';
import { CEL_DOTYKU, s } from '../uklad';

export function Ladowanie({ tekst = 'Wczytywanie...' }: { tekst?: string }) {
  return (
    <View style={style.srodek}>
      <ActivityIndicator size="large" color={Kolory.akcent} />
      <Text style={[Typografia.drobne, { marginTop: Odstepy.m }]}>{tekst}</Text>
    </View>
  );
}

export function KomunikatBledu({
  tresc,
  onPonow,
  onUstawienia,
}: {
  tresc: string;
  onPonow?: () => void;
  onUstawienia?: () => void;
}) {
  return (
    <View style={style.srodek}>
      <View style={style.kartaBledu}>
        <Text style={style.tytulBledu}>Nie udalo sie pobrac danych</Text>
        <Text style={style.trescBledu}>{tresc}</Text>
        <View style={style.przyciski}>
          {onPonow ? (
            <Pressable style={[style.przycisk, style.przyciskGlowny]} onPress={onPonow}>
              <Text style={style.tekstGlowny}>Sprobuj ponownie</Text>
            </Pressable>
          ) : null}
          {onUstawienia ? (
            <Pressable style={[style.przycisk, style.przyciskDrugi]} onPress={onUstawienia}>
              <Text style={style.tekstDrugi}>Ustawienia</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function Pusto({ tytul, opis }: { tytul: string; opis?: string }) {
  return (
    <View style={style.pusto}>
      <Text style={style.pustoTytul}>{tytul}</Text>
      {opis ? <Text style={style.pustoOpis}>{opis}</Text> : null}
    </View>
  );
}

const style = StyleSheet.create({
  srodek: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Odstepy.xl,
  },
  kartaBledu: {
    width: '100%',
    backgroundColor: Kolory.bladTlo,
    borderWidth: 1,
    borderColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.l,
    padding: Odstepy.l,
  },
  tytulBledu: {
    ...Typografia.tytul,
    color: Kolory.blad,
    marginBottom: Odstepy.s,
  },
  trescBledu: {
    fontSize: s(14),
    lineHeight: s(20),
    color: Kolory.tekstDrugi,
  },
  przyciski: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Odstepy.s,
    marginTop: Odstepy.l,
  },
  przycisk: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(12),
    paddingHorizontal: Odstepy.l,
    borderRadius: Zaokraglenia.m,
    minHeight: CEL_DOTYKU,
  },
  przyciskGlowny: { backgroundColor: Kolory.akcent },
  przyciskDrugi: {
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
  },
  tekstGlowny: { color: Kolory.tekstNaAkcencie, fontWeight: '700' },
  tekstDrugi: { color: Kolory.tekstDrugi, fontWeight: '700' },
  pusto: {
    alignItems: 'center',
    paddingVertical: Odstepy.xxl,
    paddingHorizontal: Odstepy.xl,
  },
  pustoTytul: {
    ...Typografia.podtytul,
    color: Kolory.tekstDrugi,
    textAlign: 'center',
  },
  pustoOpis: {
    ...Typografia.drobne,
    textAlign: 'center',
    marginTop: Odstepy.xs,
    lineHeight: s(19),
  },
});
