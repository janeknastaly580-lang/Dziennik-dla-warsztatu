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
 * Dzien zmienia sie strzalkami, a dotkniecie jego nazwy rozwija siatke
 * miesiaca - patrz `PasekDnia`. Bloki w tle to wizyty juz zaplanowane na ten
 * dzien: mechanik widzi zajete godziny w chwili wybierania, a nie po zapisie.
 * Wszystko idzie z lokalnej bazy, wiec dziala tak samo bez zasiegu (D1).
 *
 * Swiadomie NIE ma tu ani jednej linijki instrukcji: ksztalt, kolka i
 * przyciaganie tlumacza sie same, a kazde zdanie na tym ekranie zabieraloby
 * miejsce samemu kalendarzowi.
 *
 * Nie uzywamy komponentu `Modal` - tak samo jak w `Potwierdzenie.tsx`,
 * bo na webie renderuje sie poza ramka komputera. Dlatego tez skladaja sie
 * na to DWA komponenty: wiersz siedzi w formularzu, a `KalendarzTerminu`
 * ekran musi wstawic OBOK formularza. Nakladka rozpieta wewnatrz
 * przewijanej tresci przykrylaby tylko wlasna sekcje, a nie caly ekran.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';

import { Przycisk } from './Formularz';
import PasekDnia from './PasekDnia';
import SiatkaDni, { PIKSELE_NA_MINUTE } from './SiatkaDni';
import { wizytyDnia } from '../dane/repozytorium';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import {
  DZIEN, MIN_DLUGOSC, type Termin, dlugosc, doKroku, etykietaDnia,
  formatujCzasTrwania, formatujGodziny, naGodzine, naMinuty, wzgledemDzis,
} from '../termin';
import { CEL_DOTYKU, s } from '../uklad';
import type { Wizyta } from '../typy';

/** Jak gleboko w bloku siedzi kropka uchwytu. */
const WCIECIE_UCHWYTU = s(12);
/** Szerokosc godziny krawedzi - tyle, ile kolumna godzin na siatce. */
const SZEROKOSC_KRAWEDZI = s(50) - s(8);
/** Widoczna kropka uchwytu; obszar dotyku jest duzo wiekszy. */
const PROMIEN_UCHWYTU = s(8);

const ogranicz = (wartosc: number, min: number, max: number) =>
  Math.min(Math.max(wartosc, min), max);

/* ===================================================================== */
/*  Wiersz w formularzu                                                   */
/* ===================================================================== */

export default function WierszTerminu({
  wartosc, onNacisnij,
}: {
  /** null = termin jeszcze nie wybrany (nowe zgloszenie). */
  wartosc: Termin | null;
  onNacisnij: () => void;
}) {
  const dzien = wartosc
    ? [wzgledemDzis(wartosc.data), etykietaDnia(wartosc.data)].filter(Boolean).join(' · ')
    : 'Wybierz termin';

  return (
    <Pressable
      onPress={() => { Keyboard.dismiss(); onNacisnij(); }}
      accessibilityRole="button"
      accessibilityLabel={wartosc
        ? `Termin: ${dzien}, ${formatujGodziny(wartosc)}`
        : 'Wybierz termin wizyty w kalendarzu'}
      style={({ pressed }) => [
        style.wiersz,
        !wartosc && style.wierszPusty,
        pressed && style.wierszWcisniety,
      ]}
    >
      <View style={style.wierszTresc}>
        <Text style={[style.wierszDzien, !wartosc && style.wierszDzienPusty]}>
          {dzien}
          {wartosc ? null : <Text style={style.gwiazdka}> *</Text>}
        </Text>
        {wartosc ? (
          <Text style={style.wierszGodziny}>
            {formatujGodziny(wartosc)}
            {'   ·   '}
            {formatujCzasTrwania(dlugosc(wartosc))}
          </Text>
        ) : null}
      </View>
      <Text style={style.wierszStrzalka}>{'›'}</Text>
    </Pressable>
  );
}

/* ===================================================================== */
/*  Kalendarz z wybieranym terminem                                       */
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
  /* Godzina, na ktorej staje widok. Celowo NIE zmienia sie przy przeciaganiu -
     siatka uciekalaby spod palca; przestawia ja dopiero zmiana dnia. */
  const [przewinDo] = useState(() => naMinuty(wartosc.godzinaOd));

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

  /* Escape zamyka kalendarz, a nie caly formularz. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const naKlawisz = (zdarzenie: KeyboardEvent) => {
      if (zdarzenie.key === 'Escape') onAnuluj();
    };
    window.addEventListener('keydown', naKlawisz);
    return () => window.removeEventListener('keydown', naKlawisz);
  }, [onAnuluj]);

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

  const gorna = od * PIKSELE_NA_MINUTE;
  const dolna = koniec * PIKSELE_NA_MINUTE;
  const termin: Termin = { data, godzinaOd: naGodzine(od), godzinaDo: naGodzine(koniec) };

  /** Etykieta godziny chowa sie, gdy zaslania ja godzina krawedzi bloku. */
  const ukryjGodzine = useCallback((y: number) => (
    Math.abs(y - od * PIKSELE_NA_MINUTE) < s(15)
    || Math.abs(y - koniec * PIKSELE_NA_MINUTE) < s(15)
  ), [od, koniec]);

  return (
    <View style={style.warstwa}>
      <PasekDnia data={data} onZmiana={setData} />

      <SiatkaDni
        dni={[data]}
        wizyty={zajete}
        przewinDo={przewinDo}
        tlo={tlo.panHandlers}
        rezerwacjaOd={od}
        rezerwacjaDo={koniec}
        ukryjGodzine={ukryjGodzine}
      >
        {({ left, width }) => (
          <>
            {/* Wybrany termin */}
            <View
              style={[style.blok, { top: gorna, height: dolna - gorna, left, width }]}
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
                left: left + WCIECIE_UCHWYTU - CEL_DOTYKU / 2,
              }]}
              {...gesty.gora.panHandlers}
            >
              <View style={style.kropka} />
            </View>
            <View
              style={[style.uchwyt, {
                top: dolna - CEL_DOTYKU / 2,
                left: left + width - WCIECIE_UCHWYTU - CEL_DOTYKU / 2,
              }]}
              {...gesty.dol.panHandlers}
            >
              <View style={style.kropka} />
            </View>
          </>
        )}
      </SiatkaDni>

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
  // Pusty termin ma wygladac jak brakujaca odpowiedz, a nie jak ozdobnik.
  wierszPusty: { borderColor: Kolory.obramowanieMocne, borderStyle: 'dashed' },
  wierszDzienPusty: { color: Kolory.tekstDrugi },
  gwiazdka: { color: Kolory.pilne },
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

  blok: {
    position: 'absolute',
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
    width: SZEROKOSC_KRAWEDZI,
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
