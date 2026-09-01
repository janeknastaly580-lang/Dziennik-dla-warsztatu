/**
 * Siatka jednej doby - wspolna dla ekranu kalendarza i dla wyboru terminu.
 *
 * Rysuje linie godzin, kolumne z godzinami po lewej i wizyty tego dnia jako
 * bloki na wysokosci odpowiadajacej ich czasowi trwania. Wizyty, ktore
 * nachodza na siebie, dziela szerokosc na kolumny - inaczej ta pozniejsza
 * zaslanialaby wczesniejsza i nie dalo by sie w nia wejsc.
 *
 * Komponent NIE rysuje wybieranego terminu - robi to `WyborTerminu` przez
 * `children`. Zna za to jego godziny (`rezerwacjaOd` / `rezerwacjaDo`) i
 * wpuszcza go do tego samego ukladu kolumn, wiec wybierany blok nie zaslania
 * wizyt, ktore juz stoja o tej porze. Polozenie kolumny dostaje z powrotem
 * jako argument `children`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
  type GestureResponderHandlers, type LayoutChangeEvent,
} from 'react-native';

import { Kolory, Odstepy, Zaokraglenia, cien, opisStatusu } from '../motyw';
import { DZIEN, MIN_DLUGOSC, naGodzine, naMinuty } from '../termin';
import { s } from '../uklad';
import type { Wizyta } from '../typy';

/** Wysokosc jednej godziny - z niej wynikaja wszystkie pozycje na siatce. */
export const WYS_GODZINY = s(56);
export const PIKSELE_NA_MINUTE = WYS_GODZINY / 60;
/** Kolumna z godzinami po lewej. */
export const SZEROKOSC_GODZIN = s(50);
export const WYSOKOSC_SIATKI = DZIEN * PIKSELE_NA_MINUTE;
/** Zapas po prawej stronie blokow. */
const MARGINES_BLOKU = Odstepy.s;

const GODZINY = Array.from({ length: 24 }, (_, i) => i);

/** Klucz pozycji, ktora nie jest wizyta, tylko wlasnie wybieranym terminem. */
const REZERWACJA = '@rezerwacja';

type Pozycja = { id: string; od: number; koniec: number; wizyta?: Wizyta };
type Ulozona = Pozycja & { kolumna: number; kolumn: number };

/** Gdzie i jak szeroko rysowac blok - to samo dla wizyt i dla rezerwacji. */
export type PolozenieBloku = { left: number; width: number };

/**
 * Rozklada wizyty na kolumny: kazda dostaje pierwsza wolna kolumne wsrod
 * tych, z ktorymi sie zazebia. Grupa konczy sie, gdy nowa wizyta zaczyna
 * sie po najpozniejszym dotychczasowym koncu - wtedy szerokosc wraca do
 * calej siatki.
 */
function ulozPozycje(wejscie: Pozycja[]): Ulozona[] {
  const pozycje = [...wejscie].sort((a, b) => a.od - b.od || a.koniec - b.koniec);

  const wynik: Ulozona[] = [];
  let grupa: Ulozona[] = [];
  let koniecGrupy = -1;

  const zamknijGrupe = () => {
    const kolumn = grupa.reduce((maks, p) => Math.max(maks, p.kolumna + 1), 1);
    grupa.forEach((p) => { p.kolumn = kolumn; });
    grupa = [];
  };

  for (const pozycja of pozycje) {
    if (grupa.length && pozycja.od >= koniecGrupy) {
      zamknijGrupe();
      koniecGrupy = -1;
    }
    const zajete = new Set(
      grupa.filter((p) => p.koniec > pozycja.od).map((p) => p.kolumna),
    );
    let kolumna = 0;
    while (zajete.has(kolumna)) kolumna += 1;

    const ulozona: Ulozona = { ...pozycja, kolumna, kolumn: 1 };
    grupa.push(ulozona);
    wynik.push(ulozona);
    koniecGrupy = Math.max(koniecGrupy, pozycja.koniec);
  }
  if (grupa.length) zamknijGrupe();

  return wynik;
}

type Props = {
  /** Dzien pokazywany na siatce; jego zmiana ustawia widok na `przewinDo`. */
  dzien: string;
  wizyty: Wizyta[];
  /** Minuta, na ktorej ma stanac widok. Null = zostaw, gdzie jest. */
  przewinDo?: number | null;
  /** Wizyta narysowana mocniej - ta, z ktorej mechanik tu przyszedl. */
  wyrozniona?: string | null;
  /** Gdy podane, bloki wizyt sa klikalne. */
  onWizyta?: (wizyta: Wizyta) => void;
  /** Uchwyty gestu dla pustego tla siatki. */
  tlo?: GestureResponderHandlers;
  /** Godziny wybieranego terminu - dziela szerokosc z wizytami tego dnia. */
  rezerwacjaOd?: number | null;
  rezerwacjaDo?: number | null;
  /** Ukrywa etykiete godziny (bo zaslania ja godzina krawedzi bloku). */
  ukryjGodzine?: (y: number) => boolean;
  /** Rysowane na wierzchu siatki - blok wybieranego terminu z uchwytami. */
  children?: React.ReactNode | ((polozenie: PolozenieBloku) => React.ReactNode);
};

export default function SiatkaDnia({
  dzien, wizyty, przewinDo, wyrozniona, onWizyta, tlo, rezerwacjaOd, rezerwacjaDo,
  ukryjGodzine, children,
}: Props) {
  const przewijanie = useRef<ScrollView>(null);
  const [szerokosc, setSzerokosc] = useState(0);

  const zmierz = useCallback((zdarzenie: LayoutChangeEvent) => {
    setSzerokosc(zdarzenie.nativeEvent.layout.width);
  }, []);

  /* Widok staje na godzinie, o ktora chodzi - a nie na polnocy. */
  useEffect(() => {
    if (przewinDo === null || przewinDo === undefined) return;
    const y = Math.max(0, przewinDo * PIKSELE_NA_MINUTE - WYS_GODZINY * 1.5);
    const uchwyt = setTimeout(() => przewijanie.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(uchwyt);
  }, [dzien, przewinDo]);

  const ulozone = useMemo(() => {
    const pozycje: Pozycja[] = wizyty.map((wizyta) => {
      const od = naMinuty(wizyta.godzina_od);
      return {
        id: wizyta.id,
        od,
        koniec: Math.max(naMinuty(wizyta.godzina_do), od + MIN_DLUGOSC),
        wizyta,
      };
    });
    if (rezerwacjaOd !== null && rezerwacjaOd !== undefined
      && rezerwacjaDo !== null && rezerwacjaDo !== undefined) {
      pozycje.push({ id: REZERWACJA, od: rezerwacjaOd, koniec: rezerwacjaDo });
    }
    return ulozPozycje(pozycje);
  }, [wizyty, rezerwacjaOd, rezerwacjaDo]);

  const dostepna = Math.max(0, szerokosc - SZEROKOSC_GODZIN - MARGINES_BLOKU);
  const polozenie = (kolumna: number, kolumn: number): PolozenieBloku => ({
    left: SZEROKOSC_GODZIN + kolumna * (dostepna / kolumn),
    width: dostepna / kolumn - (kolumn > 1 ? s(3) : 0),
  });

  const rezerwacja = ulozone.find((p) => p.id === REZERWACJA);
  const polozenieRezerwacji = rezerwacja
    ? polozenie(rezerwacja.kolumna, rezerwacja.kolumn)
    : { left: SZEROKOSC_GODZIN, width: dostepna };

  return (
    <ScrollView
      ref={przewijanie}
      style={style.przewijanie}
      contentContainerStyle={style.tresc}
      showsVerticalScrollIndicator={false}
    >
      <View style={style.siatka} onLayout={zmierz}>
        {tlo ? <View style={style.tlo} {...tlo} /> : null}

        {/* Linie i godziny */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {GODZINY.map((godzina) => {
            const y = godzina * WYS_GODZINY;
            return (
              <View key={godzina} style={[style.linia, { top: y }]}>
                {ukryjGodzine?.(y) ? null : (
                  <Text style={style.liniaGodzina}>{naGodzine(godzina * 60)}</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Wizyty tego dnia */}
        {dostepna > 0 ? ulozone.map(({ wizyta, od, koniec, kolumna, kolumn }) => {
          if (!wizyta) return null;
          const kolory = opisStatusu(wizyta.status);
          const wymiary = {
            top: od * PIKSELE_NA_MINUTE,
            height: (koniec - od) * PIKSELE_NA_MINUTE,
            ...polozenie(kolumna, kolumn),
            backgroundColor: kolory.tlo,
            borderColor: kolory.obramowanie,
            borderLeftColor: kolory.kolor,
          };
          const tresc = (
            <>
              <Text style={style.wizytaTytul} numberOfLines={1}>{wizyta.tytul}</Text>
              <Text style={style.wizytaPodpis} numberOfLines={1}>
                {naGodzine(od)}
                {'–'}
                {naGodzine(koniec)}
                {wizyta.klient_nazwa ? `  ·  ${wizyta.klient_nazwa}` : ''}
              </Text>
            </>
          );

          return onWizyta ? (
            <Pressable
              key={wizyta.id}
              onPress={() => onWizyta(wizyta)}
              accessibilityRole="button"
              accessibilityLabel={`${wizyta.tytul}, ${naGodzine(od)} do ${naGodzine(koniec)}`}
              style={({ pressed }) => [
                style.wizyta,
                wymiary,
                wizyta.id === wyrozniona && style.wizytaWyrozniona,
                pressed && style.wizytaWcisnieta,
              ]}
            >
              {tresc}
            </Pressable>
          ) : (
            <View
              key={wizyta.id}
              pointerEvents="none"
              style={[
                style.wizyta,
                wymiary,
                wizyta.id === wyrozniona && style.wizytaWyrozniona,
              ]}
            >
              {tresc}
            </View>
          );
        }) : null}

        {typeof children === 'function' ? children(polozenieRezerwacji) : children}
      </View>
    </ScrollView>
  );
}

const style = StyleSheet.create({
  przewijanie: { flex: 1 },
  tresc: { paddingBottom: Odstepy.xl },
  siatka: {
    height: WYSOKOSC_SIATKI,
    backgroundColor: Kolory.powierzchnia,
  },
  tlo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: SZEROKOSC_GODZIN,
    right: 0,
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

  wizyta: {
    position: 'absolute',
    borderWidth: 1,
    borderLeftWidth: s(4),
    borderRadius: Zaokraglenia.s,
    paddingHorizontal: Odstepy.s,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  // Wizyta, po ktora mechanik tu przyszedl: ramka w kolorze akcentu.
  // Status dalej widac po tle i po grubym pasku z lewej.
  wizytaWyrozniona: {
    borderWidth: s(2.5),
    borderColor: Kolory.akcent,
    ...cien('lekki'),
  },
  wizytaWcisnieta: { opacity: 0.75 },
  wizytaTytul: { fontSize: s(12), fontWeight: '700', color: Kolory.tekstDrugi },
  wizytaPodpis: { fontSize: s(10.5), color: Kolory.tekstSlaby },
});
