/**
 * Kalendarz kilku dni obok siebie.
 *
 * Godziny stoja w stalej kolumnie po lewej, a kazdy dzien dostaje wlasna
 * kolumne z wizytami narysowanymi na wysokosci swojego czasu trwania.
 * Wizyty, ktore w jednym dniu zachodza na siebie, dziela szerokosc TEJ
 * kolumny - dokladnie tak samo, jak w widoku jednego dnia (`SiatkaDnia`),
 * z ktorego bierzemy uklad i wymiary.
 *
 * Naglowek z dniami stoi NAD przewijana siatka, wiec nazwy dni zostaja na
 * ekranie, kiedy mechanik przewija dobe w gore i w dol.
 *
 * Czerwona linia to biezaca godzina. Rysuje sie tylko wtedy, gdy dzisiejszy
 * dzien jest w widocznym zakresie - inaczej mowilaby o czasie, ktorego na
 * ekranie nie ma.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent,
} from 'react-native';

import {
  PIKSELE_NA_MINUTE, SZEROKOSC_GODZIN, WYSOKOSC_SIATKI, WYS_GODZINY,
  pozycjaWizyty, ulozPozycje,
} from './SiatkaDnia';
import { Kolory, Odstepy, Zaokraglenia, cien, opisStatusu } from '../motyw';
import { dzisiaj, etykietaKolumny, etykietaKrotka, naGodzine, terazMinuty } from '../termin';
import { s } from '../uklad';
import type { Wizyta } from '../typy';

const GODZINY = Array.from({ length: 24 }, (_, i) => i);
/** Odstep miedzy blokiem a prawa krawedzia jego kolumny. */
const LUZ_KOLUMNY = s(6);
/** Co ile odswieza sie linia biezacej godziny. */
const ODSWIEZANIE_LINII_MS = 60_000;

type Props = {
  /** Dni pokazywane obok siebie, po kolei. */
  dni: string[];
  wizyty: Wizyta[];
  /** Minuta, na ktorej ma stanac widok po wejsciu i po zmianie zakresu. */
  przewinDo?: number | null;
  /** Wizyta narysowana mocniej - ta, z ktorej mechanik tu przyszedl. */
  wyrozniona?: string | null;
  onWizyta: (wizyta: Wizyta) => void;
};

export default function SiatkaDni({
  dni, wizyty, przewinDo, wyrozniona, onWizyta,
}: Props) {
  const przewijanie = useRef<ScrollView>(null);
  const [szerokosc, setSzerokosc] = useState(0);
  const [teraz, setTeraz] = useState(() => terazMinuty());

  const zmierz = useCallback((zdarzenie: LayoutChangeEvent) => {
    setSzerokosc(zdarzenie.nativeEvent.layout.width);
  }, []);

  /* Widok staje na godzinie, o ktora chodzi - a nie na polnocy. */
  const zakres = dni.join('|');
  useEffect(() => {
    if (przewinDo === null || przewinDo === undefined) return;
    const y = Math.max(0, przewinDo * PIKSELE_NA_MINUTE - WYS_GODZINY * 1.5);
    const uchwyt = setTimeout(() => przewijanie.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(uchwyt);
  }, [zakres, przewinDo]);

  /* Linia "teraz" przesuwa sie co minute; czesciej nie ma czego pokazywac. */
  useEffect(() => {
    const zegar = setInterval(() => setTeraz(terazMinuty()), ODSWIEZANIE_LINII_MS);
    return () => clearInterval(zegar);
  }, []);

  const szerokoscDnia = dni.length
    ? Math.max(0, szerokosc - SZEROKOSC_GODZIN) / dni.length
    : 0;

  /** Wizyty rozdzielone na dni i ulozone w kolumny wewnatrz kazdego dnia. */
  const ulozone = useMemo(() => dni.map((dzien) => ulozPozycje(
    wizyty.filter((w) => String(w.data_wizyty ?? '').slice(0, 10) === dzien)
      .map(pozycjaWizyty),
  )), [dni, wizyty]);

  const dzis = dzisiaj();
  const kolumnaDzis = dni.indexOf(dzis);

  return (
    <View style={style.calosc}>
      {/* Naglowek z dniami - zostaje na ekranie przy przewijaniu doby. */}
      <View style={style.naglowek} onLayout={zmierz}>
        <View style={style.naglowekGodziny} />
        {dni.map((dzien) => (
          <View
            key={dzien}
            style={[
              style.naglowekDnia,
              { width: szerokoscDnia || undefined, flex: szerokoscDnia ? undefined : 1 },
              dzien === dzis && style.naglowekDzis,
            ]}
          >
            {dzien === dzis ? <Text style={style.podpisDzis}>Dzis</Text> : null}
            <Text
              style={[style.nazwaDnia, dzien === dzis && style.nazwaDniaDzis]}
              numberOfLines={1}
            >
              {etykietaKolumny(dzien)}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView
        ref={przewijanie}
        style={style.przewijanie}
        contentContainerStyle={style.tresc}
        showsVerticalScrollIndicator={false}
      >
        <View style={style.siatka}>
          {/* Linie godzin i podzial na dni */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {GODZINY.map((godzina) => (
              <View key={godzina} style={[style.linia, { top: godzina * WYS_GODZINY }]}>
                <Text style={style.liniaGodzina}>{naGodzine(godzina * 60)}</Text>
              </View>
            ))}
            {dni.map((dzien, i) => (
              <View
                key={dzien}
                style={[style.kreskaDnia, { left: SZEROKOSC_GODZIN + i * szerokoscDnia }]}
              />
            ))}
          </View>

          {/* Wizyty - kazda w kolumnie swojego dnia */}
          {szerokoscDnia > 0 ? ulozone.map((wDniu, i) => wDniu.map(
            ({ wizyta, od, koniec, kolumna, kolumn }) => {
              if (!wizyta) return null;
              const kolory = opisStatusu(wizyta.status);
              const szerokoscBloku = (szerokoscDnia - LUZ_KOLUMNY) / kolumn;

              return (
                <Pressable
                  key={wizyta.id}
                  onPress={() => onWizyta(wizyta)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${wizyta.tytul}, ${etykietaKrotka(dni[i])}, `
                    + `${naGodzine(od)} do ${naGodzine(koniec)}`
                  }
                  style={({ pressed }) => [
                    style.wizyta,
                    {
                      top: od * PIKSELE_NA_MINUTE,
                      height: (koniec - od) * PIKSELE_NA_MINUTE,
                      left: SZEROKOSC_GODZIN + i * szerokoscDnia + kolumna * szerokoscBloku,
                      width: szerokoscBloku - (kolumn > 1 ? s(2) : 0),
                      backgroundColor: kolory.tlo,
                      borderColor: kolory.obramowanie,
                      borderLeftColor: kolory.kolor,
                    },
                    wizyta.id === wyrozniona && style.wizytaWyrozniona,
                    pressed && style.wizytaWcisnieta,
                  ]}
                >
                  <Text style={style.wizytaTytul} numberOfLines={1}>{wizyta.tytul}</Text>
                  <Text style={style.wizytaPodpis} numberOfLines={1}>
                    {naGodzine(od)}
                    {'-'}
                    {naGodzine(koniec)}
                    {wizyta.klient_nazwa ? ` · ${wizyta.klient_nazwa}` : ''}
                  </Text>
                </Pressable>
              );
            },
          )) : null}

          {/* Biezaca godzina - tylko gdy dzis jest w tym zakresie */}
          {kolumnaDzis >= 0 ? (
            <View
              pointerEvents="none"
              style={[style.teraz, { top: teraz * PIKSELE_NA_MINUTE }]}
            >
              <Text style={style.terazGodzina}>{naGodzine(teraz)}</Text>
              <View style={style.terazKreska} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const style = StyleSheet.create({
  calosc: { flex: 1 },

  naglowek: {
    flexDirection: 'row',
    backgroundColor: Kolory.powierzchnia,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.obramowanie,
  },
  naglowekGodziny: { width: SZEROKOSC_GODZIN },
  naglowekDnia: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: Odstepy.s,
    borderLeftWidth: 1,
    borderLeftColor: Kolory.obramowanie,
  },
  naglowekDzis: { backgroundColor: Kolory.akcentTlo },
  podpisDzis: {
    fontSize: s(10),
    fontWeight: '800',
    letterSpacing: 0.4,
    color: Kolory.akcent,
  },
  nazwaDnia: { fontSize: s(14), fontWeight: '700', color: Kolory.tekstDrugi },
  nazwaDniaDzis: { color: Kolory.akcentCiemny, fontWeight: '800' },

  przewijanie: { flex: 1 },
  tresc: { paddingBottom: Odstepy.xl },
  siatka: {
    height: WYSOKOSC_SIATKI,
    backgroundColor: Kolory.powierzchnia,
  },
  linia: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WYS_GODZINY,
    borderTopWidth: 1,
    borderTopColor: Kolory.obramowanie,
  },
  liniaGodzina: {
    position: 'absolute',
    top: -s(8),
    left: 0,
    width: SZEROKOSC_GODZIN - s(8),
    textAlign: 'right',
    fontSize: s(11.5),
    color: Kolory.tekstSlaby,
  },
  kreskaDnia: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: Kolory.obramowanie,
  },

  wizyta: {
    position: 'absolute',
    borderWidth: 1,
    borderLeftWidth: s(4),
    borderRadius: Zaokraglenia.s,
    paddingHorizontal: s(6),
    paddingVertical: 2,
    overflow: 'hidden',
  },
  wizytaWyrozniona: {
    borderWidth: s(2.5),
    borderColor: Kolory.akcent,
    ...cien('lekki'),
  },
  wizytaWcisnieta: { opacity: 0.75 },
  wizytaTytul: { fontSize: s(11.5), fontWeight: '700', color: Kolory.tekstDrugi },
  wizytaPodpis: { fontSize: s(10), color: Kolory.tekstSlaby },

  teraz: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  terazGodzina: {
    width: SZEROKOSC_GODZIN - s(8),
    marginTop: -s(1),
    textAlign: 'right',
    fontSize: s(11),
    fontWeight: '800',
    color: Kolory.pilne,
  },
  terazKreska: {
    flex: 1,
    height: 1,
    marginLeft: s(8),
    backgroundColor: Kolory.pilne,
  },
});
