/**
 * Siatka doby - jedna dla obu miejsc, w ktorych aplikacja rysuje godziny:
 * kalendarza warsztatu i wyboru terminu wizyty. Oba pokazuja te same cztery
 * dni obok siebie (`DNI_W_WIDOKU`), wiec mechanik wybiera termin na tym
 * samym widoku, na ktorym oglada grafik.
 *
 * Godziny stoja w stalej kolumnie po lewej, kazdy dzien dostaje wlasna
 * kolumne, a wizyty ida na wysokosci swojego czasu trwania. Te, ktore w
 * jednym dniu zachodza na siebie, dziela szerokosc TEJ kolumny - inaczej
 * pozniejsza zaslanialaby wczesniejsza i nie dalo by sie w nia wejsc.
 *
 * Roznice miedzy oboma widokami sprowadzaja sie do kilku propsow:
 *
 *   kalendarz       `onWizyta` - bloki wizyt sa klikalne.
 *   wybor terminu   `rezerwacjaData` i `rezerwacjaOd/Do` (wybierany blok
 *                   wchodzi do ukladu kolumn SWOJEGO dnia, wiec nie zaslania
 *                   zajetych godzin), `tlo` z gestem dla kazdej kolumny
 *                   i `children` na wierzchu siatki.
 *
 * Naglowek z dniami stoi NAD przewijana siatka, wiec nazwy dni zostaja na
 * ekranie, kiedy mechanik przewija dobe w gore i w dol.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
  type GestureResponderHandlers, type LayoutChangeEvent,
} from 'react-native';

import { Kolory, Odstepy, Zaokraglenia, cien, opisStatusu } from '../motyw';
import {
  DZIEN, MIN_DLUGOSC, dzisiaj, etykietaKolumny, naGodzine, naMinuty, terazMinuty,
} from '../termin';
import { s } from '../uklad';
import type { Wizyta } from '../typy';

/** Ile dni stoi obok siebie - w kalendarzu i przy wyborze terminu. */
export const DNI_W_WIDOKU = 4;
/** Wysokosc jednej godziny - z niej wynikaja wszystkie pozycje na siatce. */
export const WYS_GODZINY = s(56);
export const PIKSELE_NA_MINUTE = WYS_GODZINY / 60;
/** Kolumna z godzinami po lewej. */
export const SZEROKOSC_GODZIN = s(50);
const WYSOKOSC_SIATKI = DZIEN * PIKSELE_NA_MINUTE;
/** Zapas przy prawej krawedzi kolumny dnia. */
const LUZ_DNIA = Odstepy.s;
/** Odstep miedzy blokami, ktore dziela te sama godzine. */
const LUZ_BLOKU = s(3);
/** Co ile odswieza sie linia biezacej godziny. */
const ODSWIEZANIE_LINII_MS = 60_000;

const GODZINY = Array.from({ length: 24 }, (_, i) => i);
/** Klucz pozycji, ktora nie jest wizyta, tylko wlasnie wybieranym terminem. */
const REZERWACJA = '@rezerwacja';

type Pozycja = { id: string; od: number; koniec: number; wizyta?: Wizyta };
type Ulozona = Pozycja & { kolumna: number; kolumn: number };

/** Gdzie i jak szeroko rysowac blok - to samo dla wizyt i dla rezerwacji. */
export type PolozenieBloku = { left: number; width: number };

/** Wizyta sprowadzona do dwoch liczb: poczatku i konca w minutach doby. */
function pozycjaWizyty(wizyta: Wizyta): Pozycja {
  const od = naMinuty(wizyta.godzina_od);
  return {
    id: wizyta.id,
    od,
    koniec: Math.max(naMinuty(wizyta.godzina_do), od + MIN_DLUGOSC),
    wizyta,
  };
}

/**
 * Rozklada pozycje na kolumny: kazda dostaje pierwsza wolna kolumne wsrod
 * tych, z ktorymi sie zazebia. Grupa konczy sie, gdy nowa pozycja zaczyna
 * sie po najpozniejszym dotychczasowym koncu - wtedy szerokosc wraca do
 * calej kolumny dnia.
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
  /** Dni pokazywane obok siebie, po kolei. Jeden dzien = wybor terminu. */
  dni: string[];
  wizyty: Wizyta[];
  /** Minuta, na ktorej ma stanac widok po wejsciu i po zmianie zakresu. */
  przewinDo?: number | null;
  /** Wizyta narysowana mocniej - ta, z ktorej mechanik tu przyszedl. */
  wyrozniona?: string | null;
  /** Gdy podane, bloki wizyt sa klikalne. */
  onWizyta?: (wizyta: Wizyta) => void;
  /**
   * Uchwyty gestu dla pustego tla - osobno dla kazdej kolumny, wiec
   * dotkniecie niesie ze soba dzien, a nie tylko godzine.
   */
  tlo?: (dzien: string) => GestureResponderHandlers;
  /** Dzien, w ktorego kolumnie stoi wybierany termin; domyslnie pierwszy. */
  rezerwacjaData?: string | null;
  /** Godziny wybieranego terminu - dziela szerokosc z wizytami tego dnia. */
  rezerwacjaOd?: number | null;
  rezerwacjaDo?: number | null;
  /** Ukrywa etykiete godziny (bo zaslania ja godzina krawedzi bloku). */
  ukryjGodzine?: (y: number) => boolean;
  /** Rysowane na wierzchu siatki - blok wybieranego terminu z uchwytami. */
  children?: React.ReactNode | ((polozenie: PolozenieBloku) => React.ReactNode);
};

export default function SiatkaDni({
  dni, wizyty, przewinDo, wyrozniona, onWizyta, tlo,
  rezerwacjaData, rezerwacjaOd, rezerwacjaDo, ukryjGodzine, children,
}: Props) {
  const przewijanie = useRef<ScrollView>(null);
  const [szerokosc, setSzerokosc] = useState(0);
  const [teraz, setTeraz] = useState(() => terazMinuty());

  const wieleDni = dni.length > 1;

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
    if (!wieleDni) return;
    const zegar = setInterval(() => setTeraz(terazMinuty()), ODSWIEZANIE_LINII_MS);
    return () => clearInterval(zegar);
  }, [wieleDni]);

  /** Dzien, w ktorego kolumnie stoi wybierany termin. */
  const dzienRezerwacji = rezerwacjaData ?? dni[0];

  /** Wizyty rozdzielone na dni, w kazdym dniu ulozone w kolumny. */
  const ulozone = useMemo(() => dni.map((dzien) => {
    const pozycje = wizyty
      .filter((w) => String(w.data_wizyty ?? '').slice(0, 10) === dzien)
      .map(pozycjaWizyty);

    // Wybierany termin wchodzi do ukladu na rowni z wizytami TEGO dnia,
    // wiec nie zaslania tego, co juz stoi o tej porze.
    if (dzien === dzienRezerwacji
      && rezerwacjaOd !== null && rezerwacjaOd !== undefined
      && rezerwacjaDo !== null && rezerwacjaDo !== undefined) {
      pozycje.push({ id: REZERWACJA, od: rezerwacjaOd, koniec: rezerwacjaDo });
    }
    return ulozPozycje(pozycje);
  }), [dni, wizyty, dzienRezerwacji, rezerwacjaOd, rezerwacjaDo]);

  const szerokoscDnia = dni.length
    ? Math.max(0, szerokosc - SZEROKOSC_GODZIN) / dni.length
    : 0;
  const dostepna = Math.max(0, szerokoscDnia - LUZ_DNIA);

  const polozenie = (dzien: number, kolumna: number, kolumn: number): PolozenieBloku => ({
    left: SZEROKOSC_GODZIN + dzien * szerokoscDnia + kolumna * (dostepna / kolumn),
    width: dostepna / kolumn - (kolumn > 1 ? LUZ_BLOKU : 0),
  });

  const indeksRezerwacji = Math.max(0, dni.indexOf(dzienRezerwacji));
  const rezerwacja = ulozone[indeksRezerwacji]?.find((p) => p.id === REZERWACJA);
  const polozenieRezerwacji = polozenie(
    indeksRezerwacji, rezerwacja?.kolumna ?? 0, rezerwacja?.kolumn ?? 1,
  );

  const dzis = dzisiaj();

  return (
    <View style={style.calosc}>
      {wieleDni ? (
        <View style={style.naglowek}>
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
      ) : null}

      <ScrollView
        ref={przewijanie}
        style={style.przewijanie}
        contentContainerStyle={style.tresc}
        showsVerticalScrollIndicator={false}
      >
        <View style={style.siatka} onLayout={zmierz}>
          {tlo ? dni.map((dzien, i) => (
            <View
              key={dzien}
              style={[style.tlo, {
                left: SZEROKOSC_GODZIN + i * szerokoscDnia,
                width: szerokoscDnia,
              }]}
              {...tlo(dzien)}
            />
          )) : null}

          {/* Linie godzin i podzial na dni */}
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
            {wieleDni ? dni.map((dzien, i) => (
              <View
                key={dzien}
                style={[style.kreskaDnia, { left: SZEROKOSC_GODZIN + i * szerokoscDnia }]}
              />
            )) : null}
          </View>

          {/* Wizyty - kazda w kolumnie swojego dnia */}
          {dostepna > 0 ? ulozone.map((wDniu, i) => wDniu.map(
            ({ wizyta, od, koniec, kolumna, kolumn }) => {
              if (!wizyta) return null;
              const kolory = opisStatusu(wizyta.status);
              const wymiary = {
                top: od * PIKSELE_NA_MINUTE,
                height: (koniec - od) * PIKSELE_NA_MINUTE,
                ...polozenie(i, kolumna, kolumn),
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
                  accessibilityLabel={
                    `${wizyta.tytul}, ${etykietaKolumny(dni[i])}, `
                    + `${naGodzine(od)} do ${naGodzine(koniec)}`
                  }
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
            },
          )) : null}

          {/* Biezaca godzina - tylko w kalendarzu i tylko gdy dzis tu jest */}
          {wieleDni && dni.includes(dzis) ? (
            <View
              pointerEvents="none"
              style={[style.teraz, { top: teraz * PIKSELE_NA_MINUTE }]}
            >
              {/* Godzina znika, gdy stoi na niej godzina krawedzi wybieranego
                  bloku - dwie liczby jedna na drugiej sa nie do odczytania.
                  Kreska zostaje, bo to ona niesie informacje. */}
              <Text style={style.terazGodzina}>
                {ukryjGodzine?.(teraz * PIKSELE_NA_MINUTE) ? '' : naGodzine(teraz)}
              </Text>
              <View style={style.terazKreska} />
            </View>
          ) : null}

          {typeof children === 'function' ? children(polozenieRezerwacji) : children}
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
  tlo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
