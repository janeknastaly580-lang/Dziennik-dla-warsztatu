/** Pozycja listy klientow na ekranie glownym. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import { CEL_DOTYKU, s } from '../uklad';
import { listaAut, odmiana } from '../format';
import type { KlientNaLiscie } from '../typy';

function inicjaly(nazwa: string): string {
  return nazwa
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

export default function KafelekKlienta({
  klient,
  onPress,
}: {
  klient: KlientNaLiscie;
  onPress: () => void;
}) {
  const otwarte = klient.liczba_otwartych ?? 0;

  const drugaLinia = [
    klient.telefon,
    listaAut(klient.auta) || null,
  ].filter(Boolean).join('  ·  ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style.karta, pressed && style.wcisniety]}
      accessibilityRole="button"
      accessibilityLabel={`Klient ${klient.nazwa}`}
    >
      <View style={[style.awatar, otwarte > 0 && style.awatarPilny]}>
        <Text style={[style.awatarTekst, otwarte > 0 && style.awatarTekstPilny]}>
          {inicjaly(klient.nazwa)}
        </Text>
      </View>

      <View style={style.srodek}>
        <Text style={style.nazwa} numberOfLines={1}>
          {klient.nazwa}
        </Text>
        {drugaLinia ? (
          <Text style={style.szczegoly} numberOfLines={1}>
            {drugaLinia}
          </Text>
        ) : (
          <Text style={style.szczegoly} numberOfLines={1}>
            Brak dodatkowych danych
          </Text>
        )}
        <Text style={style.liczniki} numberOfLines={1}>
          {klient.liczba_aut} {odmiana(klient.liczba_aut, 'auto', 'auta', 'aut')}
          {'  ·  '}
          {klient.liczba_wizyt} {odmiana(klient.liczba_wizyt, 'wizyta', 'wizyty', 'wizyt')}
        </Text>
      </View>

      {otwarte > 0 ? (
        <View style={style.znacznik}>
          <Text style={style.znacznikLiczba}>{otwarte}</Text>
          <Text style={style.znacznikOpis}>otwarte</Text>
        </View>
      ) : (
        <Text style={style.strzalka}>{'›'}</Text>
      )}
    </Pressable>
  );
}

const style = StyleSheet.create({
  karta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.l,
    padding: Odstepy.m,
    marginBottom: Odstepy.s,
    minHeight: CEL_DOTYKU + s(24),
    ...cien('lekki'),
  },
  wcisniety: {
    backgroundColor: Kolory.akcentTlo,
    borderColor: Kolory.akcent,
  },
  awatar: {
    width: s(44),
    height: s(44),
    borderRadius: Zaokraglenia.pelne,
    backgroundColor: Kolory.akcentTlo,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Odstepy.m,
  },
  awatarPilny: { backgroundColor: Kolory.pilneTlo },
  awatarTekst: { fontSize: s(16), fontWeight: '800', color: Kolory.akcent },
  awatarTekstPilny: { color: Kolory.pilne },
  srodek: { flex: 1, minWidth: 0 },
  nazwa: { fontSize: s(17), fontWeight: '700', color: Kolory.tekst },
  szczegoly: { fontSize: s(13), color: Kolory.tekstDrugi, marginTop: 2 },
  liczniki: { fontSize: s(12), color: Kolory.tekstSlaby, marginTop: 3 },
  znacznik: {
    minWidth: s(54),
    alignItems: 'center',
    backgroundColor: Kolory.pilneTlo,
    borderWidth: 1,
    borderColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.m,
    paddingVertical: 5,
    paddingHorizontal: Odstepy.s,
    marginLeft: Odstepy.s,
  },
  znacznikLiczba: { fontSize: s(17), fontWeight: '800', color: Kolory.pilne },
  znacznikOpis: { fontSize: s(10), fontWeight: '700', color: Kolory.pilne, letterSpacing: 0.3 },
  strzalka: { fontSize: s(24), color: Kolory.tekstSlaby, paddingHorizontal: Odstepy.s },
});
