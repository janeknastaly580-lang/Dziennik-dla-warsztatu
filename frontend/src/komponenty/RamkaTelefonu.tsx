/**
 * Ramka telefonu (9:16).
 *
 * Owija cala aplikacje. Na telefonie jest przezroczysta - urzadzenie i tak
 * jest wezsze niz 9/16 swojej wysokosci, wiec nic sie nie zmienia.
 *
 * Na tablecie i w przegladarce rysuje wokol tresci obudowe telefonu:
 * zaokraglony korpus, wciecie na gorze i cien. Aplikacja wyglada wtedy tak,
 * jak bedzie wygladac na telefonie, zamiast rozlewac sie na cala szerokosc.
 *
 * To jest wylacznie oprawa - kolory samej aplikacji sa nietkniete.
 */
import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Kolory } from '../motyw';
import { PROPORCJA, pewneWymiary, szerokoscKolumny } from '../uklad';

/** Odstep miedzy obudowa a krawedzia okna. */
const MARGINES = 16;
/** Grubosc obudowy wokol ekranu. */
const GRUBOSC = 12;
/** Zaokraglenie korpusu i ekranu. */
const PROMIEN_KORPUSU = 46;
const PROMIEN_EKRANU = PROMIEN_KORPUSU - GRUBOSC;
/** Pasek na gorze ekranu, w ktorym siedzi wciecie. */
const WYSOKOSC_PASKA = 26;

export default function RamkaTelefonu({ children }: { children: React.ReactNode }) {
  // pewneWymiary ratuje pierwsze renderowanie na webie, gdzie
  // react-native-web potrafi jeszcze zwracac 0 x 0.
  const { width, height } = pewneWymiary(useWindowDimensions());

  // Telefon jest wezszy niz 9/16 swojej wysokosci - dostaje pelna szerokosc.
  const szerokiEkran = width > 0 && szerokoscKolumny(width, height) < width;
  if (!szerokiEkran) {
    return <View style={style.pelny}>{children}</View>;
  }

  // Korpus jak najwyzszy, ale zawsze w proporcji 9:16 i w granicach okna.
  let wysokoscKorpusu = height - MARGINES * 2;
  let szerokoscKorpusu = Math.round(wysokoscKorpusu * PROPORCJA);
  const maksSzerokosc = width - MARGINES * 2;
  if (szerokoscKorpusu > maksSzerokosc) {
    szerokoscKorpusu = maksSzerokosc;
    wysokoscKorpusu = Math.round(szerokoscKorpusu / PROPORCJA);
  }

  return (
    <View style={style.otoczenie}>
      <View style={[style.korpus, { width: szerokoscKorpusu, height: wysokoscKorpusu }]}>
        <View style={style.ekran}>
          {/* Pasek stanu w kolorze naglowka aplikacji - tlo dla wciecia. */}
          <View style={style.pasekStanu} />
          <View style={style.tresc}>{children}</View>
          <View style={style.wcieciePas} pointerEvents="none">
            <View style={style.wciecie} />
          </View>
        </View>
      </View>
    </View>
  );
}

const style = StyleSheet.create({
  pelny: { flex: 1, backgroundColor: Kolory.tlo },

  otoczenie: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Kolory.tloOprawy,
  },
  korpus: {
    backgroundColor: Kolory.obudowa,
    borderRadius: PROMIEN_KORPUSU,
    padding: GRUBOSC,
    ...Platform.select({
      android: { elevation: 12 },
      default: {
        shadowColor: '#0B1220',
        shadowOpacity: 0.32,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 14 },
      },
    }),
  },
  ekran: {
    flex: 1,
    borderRadius: PROMIEN_EKRANU,
    overflow: 'hidden',
    backgroundColor: Kolory.tlo,
  },
  pasekStanu: {
    height: WYSOKOSC_PASKA,
    backgroundColor: Kolory.powierzchnia,
  },
  tresc: { flex: 1 },

  wcieciePas: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  wciecie: {
    width: '38%',
    height: 20,
    backgroundColor: Kolory.obudowa,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
});
