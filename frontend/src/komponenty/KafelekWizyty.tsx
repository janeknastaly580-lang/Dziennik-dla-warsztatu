/**
 * Kafelek historii wizyt / usterek.
 *
 * WYMOG PROJEKTOWY: pozycje o statusie "nienaprawione" (oraz "w trakcie")
 * sa renderowane jako DUZE, kolorowe karty z gruba lewa krawedzia, cieniem,
 * opisem usterki i wyraznymi odznakami. Pozycje "naprawione" schodza do
 * malego, stonowanego, jednowierszowego paska.
 *
 * Rozmiary sa celowo bardzo rozne (ok. 3x wysokosci), zeby otwarta usterka
 * byla widoczna na pierwszy rzut oka podczas przewijania historii.
 *
 * Wysokosc duzego kafelka jest liczona jako procent wysokosci ekranu, wiec na
 * kazdym oknie zajmuje ta sama czesc jego wysokosci - niezaleznie od tego,
 * czy okno jest male, czy rozciagniete na caly monitor.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ETYKIETA_PRIORYTETU, Kolory, Odstepy, Zaokraglenia, cien, czyOtwarta, opisStatusu,
} from '../motyw';
import { formatujDate, formatujKwote, formatujPrzebieg, opisAuta } from '../format';
import { godzinyWizyty } from '../termin';
import { CEL_DOTYKU, s, wys } from '../uklad';
import type { Wizyta } from '../typy';

type Props = {
  wizyta: Wizyta;
  onPress: () => void;
  /** Ukryj opis auta (gdy lista jest juz przefiltrowana do jednego auta). */
  ukryjAuto?: boolean;
  /** Nazwa klienta - podawana na listach zbierajacych usterki z wielu kartotek. */
  klient?: string | null;
};

export default function KafelekWizyty({ wizyta, onPress, ukryjAuto, klient }: Props) {
  return czyOtwarta(wizyta.status)
    ? <KafelekDuzy wizyta={wizyta} onPress={onPress} ukryjAuto={ukryjAuto} klient={klient} />
    : <KafelekMaly wizyta={wizyta} onPress={onPress} ukryjAuto={ukryjAuto} klient={klient} />;
}

/* ===================================================================== */
/*  DUZY kafelek - usterka nienaprawiona / w trakcie                      */
/* ===================================================================== */

function KafelekDuzy({ wizyta, onPress, ukryjAuto, klient }: Props) {
  const opis = opisStatusu(wizyta.status);
  const pilne = wizyta.priorytet === 'wysoki';
  const przebieg = formatujPrzebieg(wizyta.przebieg);
  const godziny = godzinyWizyty(wizyta);

  const stopka = [
    klient || null,
    ukryjAuto ? null : opisAuta(wizyta.auto),
    przebieg,
    // D5: mechanik ma widziec, czy jego zapis juz dotarl na serwer.
    // Bez tego niepewnosc konczy sie wpisaniem tego samego drugi raz (B3).
  ].filter(Boolean).join('   ·   ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Usterka ${wizyta.tytul}, status ${opis.etykieta}`}
      style={({ pressed }) => [
        duzy.karta,
        { backgroundColor: opis.tlo, borderColor: opis.obramowanie, borderLeftColor: opis.kolor },
        pressed && duzy.wcisniety,
      ]}
    >
      <View style={duzy.gora}>
        <View style={[duzy.odznaka, { backgroundColor: opis.kolor }]}>
          <Text style={duzy.odznakaTekst}>{opis.etykieta}</Text>
        </View>
        {pilne ? (
          <View style={duzy.odznakaPriorytet}>
            <Text style={[duzy.odznakaPriorytetTekst, { color: opis.kolor }]}>
              PRIORYTET {ETYKIETA_PRIORYTETU[wizyta.priorytet]}
            </Text>
          </View>
        ) : null}
        <View style={duzy.wypelniacz} />
        <View style={duzy.termin}>
          <Text style={duzy.data}>{formatujDate(wizyta.data_wizyty)}</Text>
          {godziny ? <Text style={duzy.godziny}>{godziny}</Text> : null}
        </View>
      </View>

      <Text style={duzy.tytul} numberOfLines={2}>
        {wizyta.tytul}
      </Text>

      {wizyta.opis ? (
        <Text style={duzy.opis} numberOfLines={3}>
          {wizyta.opis}
        </Text>
      ) : null}

      <View style={[duzy.stopka, { borderTopColor: opis.obramowanie }]}>
        <Text style={duzy.stopkaTekst} numberOfLines={1}>
          {stopka || 'Brak dodatkowych informacji'}
        </Text>
        <Text style={[duzy.akcja, { color: opis.kolor }]}>Szczegoly {'›'}</Text>
      </View>
    </Pressable>
  );
}

const duzy = StyleSheet.create({
  karta: {
    borderRadius: Zaokraglenia.l,
    borderWidth: 1,
    borderLeftWidth: s(8),
    paddingVertical: Odstepy.l,
    paddingHorizontal: Odstepy.l,
    marginBottom: Odstepy.m,
    // ok. 1/6 wysokosci okna - w kolumnie mieszcza sie 3-4 otwarte usterki
    minHeight: wys(16, 132),
    ...cien('mocny'),
  },
  wcisniety: { opacity: 0.9 },
  gora: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Odstepy.s,
    marginBottom: Odstepy.s,
  },
  odznaka: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: Zaokraglenia.pelne,
  },
  odznakaTekst: {
    color: '#FFFFFF',
    fontSize: s(11),
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  odznakaPriorytet: {
    paddingHorizontal: s(8),
    paddingVertical: s(4),
    borderRadius: Zaokraglenia.pelne,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  odznakaPriorytetTekst: { fontSize: s(10), fontWeight: '800', letterSpacing: 0.5 },
  wypelniacz: { flex: 1 },
  termin: { alignItems: 'flex-end' },
  data: { fontSize: s(13), fontWeight: '600', color: Kolory.tekstDrugi },
  godziny: { fontSize: s(11.5), fontWeight: '700', color: Kolory.tekstDrugi },
  tytul: {
    fontSize: s(20),
    lineHeight: s(26),
    fontWeight: '800',
    color: Kolory.tekst,
  },
  opis: {
    fontSize: s(14.5),
    lineHeight: s(20),
    color: Kolory.tekstDrugi,
    marginTop: Odstepy.xs,
  },
  stopka: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Odstepy.s,
    marginTop: Odstepy.m,
    paddingTop: Odstepy.s,
    borderTopWidth: 1,
  },
  stopkaTekst: { flex: 1, fontSize: s(12.5), color: Kolory.tekstDrugi },
  akcja: { fontSize: s(13), fontWeight: '800' },
});

/* ===================================================================== */
/*  MALY kafelek - usterka naprawiona                                     */
/* ===================================================================== */

function KafelekMaly({ wizyta, onPress, ukryjAuto, klient }: Props) {
  const opis = opisStatusu(wizyta.status);

  const podpis = [
    klient || null,
    ukryjAuto ? null : opisAuta(wizyta.auto),
    formatujDate(wizyta.data_wizyty),
    godzinyWizyty(wizyta),
    formatujKwote(wizyta.koszt),
  ].filter(Boolean).join('  ·  ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Naprawione: ${wizyta.tytul}`}
      style={({ pressed }) => [maly.karta, pressed && maly.wcisniety]}
    >
      <View style={[maly.kropka, { backgroundColor: opis.kolor }]} />
      <View style={maly.srodek}>
        <Text style={maly.tytul} numberOfLines={1}>
          {wizyta.tytul}
        </Text>
        <Text style={maly.podpis} numberOfLines={1}>
          {podpis}
        </Text>
      </View>
      <Text style={maly.strzalka}>{'›'}</Text>
    </Pressable>
  );
}

const maly = StyleSheet.create({
  karta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.s,
    paddingVertical: Odstepy.s,
    paddingHorizontal: Odstepy.m,
    marginBottom: s(6),
    // celowo tuz przy minimum celu dotyku - ma byc maly, ale wciaz klikalny
    minHeight: CEL_DOTYKU,
  },
  wcisniety: { backgroundColor: Kolory.powierzchniaStonowana },
  kropka: {
    width: s(8),
    height: s(8),
    borderRadius: Zaokraglenia.pelne,
    marginRight: Odstepy.m,
  },
  srodek: { flex: 1, minWidth: 0 },
  tytul: { fontSize: s(14), fontWeight: '600', color: Kolory.tekstDrugi },
  podpis: { fontSize: s(11.5), color: Kolory.tekstSlaby, marginTop: 1 },
  strzalka: { fontSize: s(18), color: Kolory.tekstSlaby, marginLeft: Odstepy.s },
});
