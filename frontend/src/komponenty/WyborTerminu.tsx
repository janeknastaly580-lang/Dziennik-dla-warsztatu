/**
 * Termin wizyty wybierany PALCEM na siatce kalendarza.
 *
 * W formularzu stoi jeden wiersz z dniem i godzinami. Dotkniecie otwiera
 * dzien na cala wysokosc ekranu: niebieski prostokat to wizyta, dwa kolka
 * na jego rogach to poczatek i koniec. Przeciagniecie kolka zmienia czas
 * trwania, przeciagniecie srodka przesuwa cala wizyte, dotkniecie pustego
 * miejsca przenosi ja tam bez zmiany dlugosci. Wszystko przyciaga sie do
 * kwadransa, wiec palec nie musi byc precyzyjny.
 *
 * Bloki w tle to wizyty juz zaplanowane na ten dzien - mechanik widzi zajete
 * godziny w chwili wybierania, a nie po zapisie. Czytane sa z lokalnej bazy,
 * wiec siatka dziala tak samo bez zasiegu (D1).
 *
 * Swiadomie NIE ma tu ani jednej linijki instrukcji: ksztalt, kolka i
 * przyciaganie tlumacza sie same, a kazde zdanie na tym ekranie zabieraloby
 * miejsce samemu kalendarzowi.
 *
 * Nie uzywamy komponentu `Modal` - tak samo jak w `Potwierdzenie.tsx`,
 * bo na webie renderuje sie poza ramka telefonu. Dlatego tez skladaja sie
 * na to DWA komponenty: wiersz siedzi w formularzu, a `KalendarzTerminu`
 * ekran musi wstawic OBOK formularza. Nakladka rozpieta wewnatrz
 * przewijanej tresci przykrylaby tylko wlasna sekcje, a nie caly ekran.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, PanResponder, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, type LayoutChangeEvent,
} from 'react-native';

import { Przycisk } from './Formularz';
import { wizytyDnia } from '../dane/repozytorium';
import { Kolory, Odstepy, Zaokraglenia, cien, opisStatusu } from '../motyw';
import {
  DZIEN, MIN_DLUGOSC, type Termin, dlugosc, doKroku, etykietaDnia,
  formatujCzasTrwania, formatujGodziny, naGodzine, naMinuty, przesunDzien, wzgledemDzis,
} from '../termin';
import { CEL_DOTYKU, s } from '../uklad';
import type { Wizyta } from '../typy';

/** Wysokosc jednej godziny - z niej wynikaja wszystkie pozycje na siatce. */
const WYS_GODZINY = s(56);
const PIKSELE_NA_MINUTE = WYS_GODZINY / 60;
/** Kolumna z godzinami po lewej. */
const SZEROKOSC_GODZIN = s(50);
/** Widoczna kropka uchwytu; obszar dotyku jest duzo wiekszy. */
const PROMIEN_UCHWYTU = s(8);
/** Jak gleboko w bloku siedzi kropka uchwytu. */
const WCIECIE_UCHWYTU = s(12);
const WYSOKOSC_SIATKI = DZIEN * PIKSELE_NA_MINUTE;
const GODZINY = Array.from({ length: 24 }, (_, i) => i);

const ogranicz = (wartosc: number, min: number, max: number) =>
  Math.min(Math.max(wartosc, min), max);

/* ===================================================================== */
/*  Wiersz w formularzu                                                   */
/* ===================================================================== */

export default function WierszTerminu({
  wartosc, onNacisnij,
}: {
  wartosc: Termin;
  onNacisnij: () => void;
}) {
  const dzien = [wzgledemDzis(wartosc.data), etykietaDnia(wartosc.data)]
    .filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={() => { Keyboard.dismiss(); onNacisnij(); }}
      accessibilityRole="button"
      accessibilityLabel={`Termin: ${dzien}, ${formatujGodziny(wartosc)}`}
      style={({ pressed }) => [style.wiersz, pressed && style.wierszWcisniety]}
    >
      <View style={style.wierszTresc}>
        <Text style={style.wierszDzien}>{dzien}</Text>
        <Text style={style.wierszGodziny}>
          {formatujGodziny(wartosc)}
          {'   ·   '}
          {formatujCzasTrwania(dlugosc(wartosc))}
        </Text>
      </View>
      <Text style={style.wierszStrzalka}>{'›'}</Text>
    </Pressable>
  );
}

/* ===================================================================== */
/*  Siatka dnia                                                           */
/* ===================================================================== */

export function KalendarzTerminu({
  wartosc, pomijanaWizyta, onGotowe, onAnuluj,
}: {
  wartosc: Termin;
  pomijanaWizyta?: string | null;
  onGotowe: (termin: Termin) => void;
  onAnuluj: () => void;
}) {
  const [data, setData] = useState(wartosc.data);
  const [od, setOd] = useState(() => naMinuty(wartosc.godzinaOd));
  const [koniec, setKoniec] = useState(() =>
    Math.max(naMinuty(wartosc.godzinaDo), naMinuty(wartosc.godzinaOd) + MIN_DLUGOSC));
  const [zajete, setZajete] = useState<Wizyta[]>([]);
  const [szerokosc, setSzerokosc] = useState(0);

  const przewijanie = useRef<ScrollView>(null);
  /** Miejsce dotkniecia tla, liczone od poczatku siatki (czyli od polnocy). */
  const dotkniecie = useRef(Number.NaN);
  /** Biezacy zakres dla gestow - te same liczby, tylko czytane synchronicznie. */
  const teraz = useRef({ od, koniec });
  teraz.current = { od, koniec };
  /** Zakres z chwili polozenia palca; do niego dodajemy przesuniecie. */
  const poczatek = useRef({ od, koniec });

  /* Zajete godziny tego dnia - z lokalnej bazy, wiec i bez zasiegu. */
  useEffect(() => {
    let aktywny = true;
    wizytyDnia(data, pomijanaWizyta)
      .then((lista) => { if (aktywny) setZajete(lista); })
      .catch(() => { if (aktywny) setZajete([]); });
    return () => { aktywny = false; };
  }, [data, pomijanaWizyta]);

  /* Sprzetowy "wstecz" zamyka kalendarz, a nie caly formularz. */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onAnuluj();
      return true;
    });
    return () => sub.remove();
  }, [onAnuluj]);

  /* Otwarcie ustawia widok na wybranych godzinach, a nie na polnocy. */
  useEffect(() => {
    const y = Math.max(0, od * PIKSELE_NA_MINUTE - WYS_GODZINY * 1.5);
    const uchwyt = setTimeout(() => przewijanie.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(uchwyt);
    // Tylko przy otwarciu - pozniej mechanik przewija dzien sam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Trzy gesty na tej samej zasadzie: przesuniecie palca w pikselach idzie
   * na minuty i przyciaga sie do kwadransa.
   *
   * `onPanResponderTerminationRequest: false` jest tu najwazniejsze - bez
   * tego przewijanie dnia odbieraloby palec w polowie przeciagania.
   */
  const gesty = useMemo(() => {
    const utworz = (tryb: 'blok' | 'gora' | 'dol') => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { poczatek.current = { ...teraz.current }; },
      onPanResponderMove: (_zdarzenie, gest) => {
        const minuty = gest.dy / PIKSELE_NA_MINUTE;
        const z = poczatek.current;

        if (tryb === 'blok') {
          const dlugoscBloku = z.koniec - z.od;
          const nowyOd = ogranicz(doKroku(z.od + minuty), 0, DZIEN - dlugoscBloku);
          setOd(nowyOd);
          setKoniec(nowyOd + dlugoscBloku);
        } else if (tryb === 'gora') {
          setOd(ogranicz(doKroku(z.od + minuty), 0, teraz.current.koniec - MIN_DLUGOSC));
        } else {
          setKoniec(ogranicz(doKroku(z.koniec + minuty), teraz.current.od + MIN_DLUGOSC, DZIEN));
        }
      },
    });
    return { blok: utworz('blok'), gora: utworz('gora'), dol: utworz('dol') };
  }, []);

  /**
   * Dotkniecie pustego miejsca przenosi wizyte, zachowujac jej dlugosc.
   * Przeciagniecie palcem po tle to przewijanie dnia - dlatego reagujemy
   * dopiero na puszczenie i tylko wtedy, gdy palec praktycznie nie drgnal.
   */
  const tlo = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // `locationY` jest liczone wzgledem tla, a wiec wzgledem calej doby -
    // przewijanie dnia nie ma na nie wplywu. Zapamietujemy je od razu, bo
    // przy puszczeniu palca zdarzenie nie niesie juz polozenia.
    onPanResponderGrant: (zdarzenie) => {
      dotkniecie.current = zdarzenie.nativeEvent.locationY;
    },
    onPanResponderRelease: (_zdarzenie, gest) => {
      if (Math.abs(gest.dx) > s(6) || Math.abs(gest.dy) > s(6)) return;
      const minuty = dotkniecie.current / PIKSELE_NA_MINUTE;
      if (!Number.isFinite(minuty)) return;
      const dlugoscBloku = teraz.current.koniec - teraz.current.od;
      const nowyOd = ogranicz(doKroku(minuty), 0, DZIEN - dlugoscBloku);
      setOd(nowyOd);
      setKoniec(nowyOd + dlugoscBloku);
    },
  }), []);

  const zmierz = useCallback((zdarzenie: LayoutChangeEvent) => {
    setSzerokosc(zdarzenie.nativeEvent.layout.width);
  }, []);

  const gorna = od * PIKSELE_NA_MINUTE;
  const dolna = koniec * PIKSELE_NA_MINUTE;
  const termin: Termin = { data, godzinaOd: naGodzine(od), godzinaDo: naGodzine(koniec) };
  const podpisDnia = wzgledemDzis(data);
  /** Etykieta godziny chowa sie, gdy zaslania ja niebieska godzina krawedzi. */
  const zaslonieta = (y: number) =>
    Math.abs(y - gorna) < s(15) || Math.abs(y - dolna) < s(15);

  return (
    <View style={style.warstwa}>
      <View style={style.naglowek}>
        <Pressable
          onPress={() => setData(przesunDzien(data, -1))}
          accessibilityRole="button"
          accessibilityLabel="Poprzedni dzien"
          hitSlop={10}
          style={({ pressed }) => [style.strzalka, pressed && style.strzalkaWcisnieta]}
        >
          <Text style={style.strzalkaTekst}>{'‹'}</Text>
        </Pressable>

        <View style={style.naglowekSrodek}>
          <Text style={style.naglowekDzien}>{etykietaDnia(data)}</Text>
          {podpisDnia ? <Text style={style.naglowekPodpis}>{podpisDnia}</Text> : null}
        </View>

        <Pressable
          onPress={() => setData(przesunDzien(data, 1))}
          accessibilityRole="button"
          accessibilityLabel="Nastepny dzien"
          hitSlop={10}
          style={({ pressed }) => [style.strzalka, pressed && style.strzalkaWcisnieta]}
        >
          <Text style={style.strzalkaTekst}>{'›'}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={przewijanie}
        style={style.przewijanie}
        contentContainerStyle={style.przewijanieTresc}
        showsVerticalScrollIndicator={false}
      >
        <View style={style.siatka} onLayout={zmierz}>
          {/* Puste miejsce - dotkniecie przenosi tam wizyte. */}
          <View style={style.tlo} {...tlo.panHandlers} />

          {/* Linie i godziny */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {GODZINY.map((godzina) => {
              const y = godzina * WYS_GODZINY;
              return (
                <View key={godzina} style={[style.linia, { top: y }]}>
                  {zaslonieta(y) ? null : (
                    <Text style={style.liniaGodzina}>{naGodzine(godzina * 60)}</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Wizyty juz zaplanowane na ten dzien */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {zajete.map((w) => {
              const zOd = naMinuty(w.godzina_od);
              const zDo = Math.max(naMinuty(w.godzina_do), zOd + MIN_DLUGOSC);
              const kolory = opisStatusu(w.status);
              return (
                <View
                  key={w.id}
                  style={[style.zajete, {
                    top: zOd * PIKSELE_NA_MINUTE,
                    height: (zDo - zOd) * PIKSELE_NA_MINUTE,
                    backgroundColor: kolory.tlo,
                    borderColor: kolory.obramowanie,
                    borderLeftColor: kolory.kolor,
                  }]}
                >
                  <Text style={style.zajeteTytul} numberOfLines={1}>{w.tytul}</Text>
                  <Text style={style.zajetePodpis} numberOfLines={1}>
                    {naGodzine(zOd)}
                    {'–'}
                    {naGodzine(zDo)}
                    {w.klient_nazwa ? `  ·  ${w.klient_nazwa}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Wybrany termin */}
          <View
            style={[style.blok, { top: gorna, height: dolna - gorna }]}
            {...gesty.blok.panHandlers}
          >
            <Text style={style.blokCzas} numberOfLines={1}>
              {formatujCzasTrwania(koniec - od)}
            </Text>
          </View>

          {/* Godziny krawedzi - w kolorze akcentu, na miejscu etykiet godzin */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Text style={[style.krawedz, { top: gorna - s(8) }]}>{naGodzine(od)}</Text>
            <Text style={[style.krawedz, { top: dolna - s(8) }]}>{naGodzine(koniec)}</Text>
          </View>

          {/* Uchwyty: poczatek na gorze po lewej, koniec na dole po prawej */}
          <View
            style={[style.uchwyt, {
              top: gorna - CEL_DOTYKU / 2,
              left: SZEROKOSC_GODZIN + WCIECIE_UCHWYTU - CEL_DOTYKU / 2,
            }]}
            {...gesty.gora.panHandlers}
          >
            <View style={style.kropka} />
          </View>
          <View
            style={[style.uchwyt, {
              top: dolna - CEL_DOTYKU / 2,
              left: Math.max(0, szerokosc - WCIECIE_UCHWYTU - CEL_DOTYKU / 2),
            }]}
            {...gesty.dol.panHandlers}
          >
            <View style={style.kropka} />
          </View>
        </View>
      </ScrollView>

      <View style={style.stopka}>
        <View style={style.stopkaOpis}>
          <Text style={style.stopkaGodziny}>{formatujGodziny(termin)}</Text>
          <Text style={style.stopkaCzas}>{formatujCzasTrwania(koniec - od)}</Text>
        </View>
        <View style={style.stopkaPrzyciski}>
          <View style={style.polowa}>
            <Przycisk tytul="Anuluj" wariant="drugi" onPress={onAnuluj} />
          </View>
          <View style={style.polowa}>
            <Przycisk tytul="Gotowe" onPress={() => onGotowe(termin)} />
          </View>
        </View>
      </View>
    </View>
  );
}

const style = StyleSheet.create({
  /* ------------------------- wiersz w formularzu ---------------------- */
  wiersz: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    backgroundColor: Kolory.powierzchniaStonowana,
    borderRadius: Zaokraglenia.m,
    paddingHorizontal: Odstepy.m,
    paddingVertical: s(10),
    minHeight: CEL_DOTYKU,
  },
  wierszWcisniety: { backgroundColor: Kolory.akcentTlo },
  wierszTresc: { flex: 1, minWidth: 0 },
  wierszDzien: { fontSize: s(15), fontWeight: '700', color: Kolory.tekst },
  wierszGodziny: { fontSize: s(13), color: Kolory.tekstDrugi, marginTop: 2 },
  wierszStrzalka: { fontSize: s(20), color: Kolory.tekstSlaby, marginLeft: Odstepy.s },

  /* ----------------------------- kalendarz ---------------------------- */
  warstwa: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Kolory.tlo,
    zIndex: 20,
  },
  naglowek: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Kolory.powierzchnia,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.obramowanie,
    paddingHorizontal: Odstepy.s,
    paddingVertical: Odstepy.s,
  },
  strzalka: {
    width: CEL_DOTYKU,
    height: CEL_DOTYKU,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Zaokraglenia.pelne,
  },
  strzalkaWcisnieta: { backgroundColor: Kolory.akcentTlo },
  strzalkaTekst: { fontSize: s(26), color: Kolory.akcent, marginTop: -s(4) },
  naglowekSrodek: { flex: 1, alignItems: 'center' },
  naglowekDzien: { fontSize: s(17), fontWeight: '800', color: Kolory.tekst },
  naglowekPodpis: {
    fontSize: s(11.5),
    fontWeight: '700',
    color: Kolory.akcent,
    letterSpacing: 0.4,
    marginTop: 1,
  },

  przewijanie: { flex: 1 },
  przewijanieTresc: { paddingBottom: Odstepy.xl },
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

  zajete: {
    position: 'absolute',
    left: SZEROKOSC_GODZIN,
    right: Odstepy.s,
    borderWidth: 1,
    borderLeftWidth: s(4),
    borderRadius: Zaokraglenia.s,
    paddingHorizontal: Odstepy.s,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  zajeteTytul: { fontSize: s(12), fontWeight: '700', color: Kolory.tekstDrugi },
  zajetePodpis: { fontSize: s(10.5), color: Kolory.tekstSlaby },

  blok: {
    position: 'absolute',
    left: SZEROKOSC_GODZIN,
    right: Odstepy.s,
    backgroundColor: Kolory.akcentTlo,
    borderWidth: s(2),
    borderColor: Kolory.akcent,
    borderRadius: Zaokraglenia.m,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...cien('lekki'),
  },
  blokCzas: { fontSize: s(13), fontWeight: '800', color: Kolory.akcentCiemny },

  krawedz: {
    position: 'absolute',
    left: 0,
    width: SZEROKOSC_GODZIN - s(8),
    textAlign: 'right',
    fontSize: s(12),
    fontWeight: '800',
    color: Kolory.akcent,
  },

  uchwyt: {
    position: 'absolute',
    width: CEL_DOTYKU,
    height: CEL_DOTYKU,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kropka: {
    width: PROMIEN_UCHWYTU * 2,
    height: PROMIEN_UCHWYTU * 2,
    borderRadius: Zaokraglenia.pelne,
    backgroundColor: Kolory.akcent,
    borderWidth: s(2.5),
    borderColor: Kolory.powierzchnia,
  },

  stopka: {
    backgroundColor: Kolory.powierzchnia,
    borderTopWidth: 1,
    borderTopColor: Kolory.obramowanie,
    paddingHorizontal: Odstepy.l,
    paddingTop: Odstepy.m,
    paddingBottom: Odstepy.l,
    gap: Odstepy.m,
  },
  stopkaOpis: { flexDirection: 'row', alignItems: 'baseline', gap: Odstepy.m },
  stopkaGodziny: { fontSize: s(20), fontWeight: '800', color: Kolory.tekst },
  stopkaCzas: { fontSize: s(14), fontWeight: '700', color: Kolory.tekstDrugi },
  stopkaPrzyciski: { flexDirection: 'row', gap: Odstepy.s },
  polowa: { flex: 1 },
});
