/**
 * Pasek z dniem (albo zakresem dni), ktory kalendarz pokazuje.
 *
 * Strzalki przesuwaja widok o `krok` dni - o cale cztery, czyli o tyle, ile
 * widac naraz. Dotkniecie nazwy rozwija siatke miesiaca - stad skok na
 * dowolna date, takze o kilka miesiecy dalej, bez przewijania dzien po dniu.
 * Kropka pod numerem znaczy, ze na ten dzien jest juz zaplanowana jakas
 * wizyta.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dniZWizytami } from '../dane/repozytorium';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import {
  DNI_TYGODNIA, dzienMiesiaca, dzisiaj, etykietaDnia, etykietaMiesiaca,
  etykietaZakresu, przesunDzien, przesunMiesiac, siatkaMiesiaca, tenSamMiesiac,
  wzgledemDzis,
} from '../termin';
import { CEL_DOTYKU, s } from '../uklad';

export default function PasekDnia({
  data, onZmiana, doData, krok = 1, wybrany,
}: {
  /** Pierwszy dzien widoku - to on zmienia sie strzalkami. */
  data: string;
  onZmiana: (data: string) => void;
  /** Ostatni dzien widoku; podany, gdy kalendarz pokazuje kilka dni naraz. */
  doData?: string;
  /** O ile dni przesuwaja strzalki. */
  krok?: number;
  /**
   * Dzien zaznaczony w siatce miesiaca; domyslnie pierwszy dzien widoku.
   * Przy wyborze terminu to dzien WIZYTY - moze stac w dowolnej z czterech
   * kolumn, a siatka ma pokazywac wlasnie jego, a nie poczatek widoku.
   */
  wybrany?: string;
}) {
  const [rozwiniety, setRozwiniety] = useState(false);
  const [miesiac, setMiesiac] = useState(data);
  const [zWizytami, setZWizytami] = useState<string[]>([]);

  const dni = useMemo(() => siatkaMiesiaca(miesiac), [miesiac]);
  const dzis = dzisiaj();
  const zaznaczony = wybrany ?? data;
  const zakres = doData && doData !== data;
  const tytul = zakres ? etykietaZakresu(data, doData) : etykietaDnia(data);
  // Przy kilku dniach naraz "Dzis" stoi juz nad wlasciwa kolumna siatki -
  // powtarzanie go w pasku tylko myliloby, ktorego dnia dotyczy.
  const podpis = zakres ? null : wzgledemDzis(data);

  /* Kropki pod dniami - tylko dla miesiaca, ktory faktycznie widac. */
  useEffect(() => {
    if (!rozwiniety) return;
    let aktywny = true;
    dniZWizytami(dni[0], dni[dni.length - 1])
      .then((lista) => { if (aktywny) setZWizytami(lista); })
      .catch(() => { if (aktywny) setZWizytami([]); });
    return () => { aktywny = false; };
  }, [rozwiniety, dni]);

  const przelacz = useCallback(() => {
    setMiesiac(data);
    setRozwiniety((otwarty) => !otwarty);
  }, [data]);

  const wybierz = useCallback((dzien: string) => {
    onZmiana(dzien);
    setRozwiniety(false);
  }, [onZmiana]);

  return (
    <View style={style.pasek}>
      <View style={style.rzad}>
        <Pressable
          onPress={() => onZmiana(przesunDzien(data, -krok))}
          accessibilityRole="button"
          accessibilityLabel={krok > 1 ? 'Poprzednie dni' : 'Poprzedni dzien'}
          hitSlop={10}
          style={({ pressed }) => [style.strzalka, pressed && style.strzalkaWcisnieta]}
        >
          <Text style={style.strzalkaTekst}>{'‹'}</Text>
        </Pressable>

        <Pressable
          onPress={przelacz}
          accessibilityRole="button"
          accessibilityLabel={`Wybierz date, teraz ${tytul}`}
          style={({ pressed }) => [style.srodek, pressed && style.srodekWcisniety]}
        >
          <Text style={style.dzien} numberOfLines={1}>
            {tytul}
            <Text style={style.znacznik}>{rozwiniety ? '  ˄' : '  ˅'}</Text>
          </Text>
          {podpis ? <Text style={style.podpis}>{podpis}</Text> : null}
        </Pressable>

        <Pressable
          onPress={() => onZmiana(przesunDzien(data, krok))}
          accessibilityRole="button"
          accessibilityLabel={krok > 1 ? 'Nastepne dni' : 'Nastepny dzien'}
          hitSlop={10}
          style={({ pressed }) => [style.strzalka, pressed && style.strzalkaWcisnieta]}
        >
          <Text style={style.strzalkaTekst}>{'›'}</Text>
        </Pressable>
      </View>

      {rozwiniety ? (
        <View style={style.miesiac}>
          <View style={style.rzad}>
            <Pressable
              onPress={() => setMiesiac(przesunMiesiac(miesiac, -1))}
              accessibilityRole="button"
              accessibilityLabel="Poprzedni miesiac"
              hitSlop={10}
              style={({ pressed }) => [style.strzalka, pressed && style.strzalkaWcisnieta]}
            >
              <Text style={style.strzalkaTekst}>{'‹'}</Text>
            </Pressable>
            <Text style={style.miesiacNazwa}>{etykietaMiesiaca(miesiac)}</Text>
            <Pressable
              onPress={() => setMiesiac(przesunMiesiac(miesiac, 1))}
              accessibilityRole="button"
              accessibilityLabel="Nastepny miesiac"
              hitSlop={10}
              style={({ pressed }) => [style.strzalka, pressed && style.strzalkaWcisnieta]}
            >
              <Text style={style.strzalkaTekst}>{'›'}</Text>
            </Pressable>
          </View>

          <View style={style.tydzien}>
            {DNI_TYGODNIA.map((nazwa) => (
              <Text key={nazwa} style={style.naglowekDnia}>{nazwa}</Text>
            ))}
          </View>

          <View style={style.kratki}>
            {dni.map((dzien) => {
              const zaznaczona = dzien === zaznaczony;
              const wTymMiesiacu = tenSamMiesiac(dzien, miesiac);
              return (
                <Pressable
                  key={dzien}
                  onPress={() => wybierz(dzien)}
                  accessibilityRole="button"
                  accessibilityLabel={etykietaDnia(dzien)}
                  style={({ pressed }) => [
                    style.kratka,
                    dzien === dzis && style.kratkaDzis,
                    zaznaczona && style.kratkaWybrana,
                    pressed && !zaznaczona && style.kratkaWcisnieta,
                  ]}
                >
                  <Text
                    style={[
                      style.kratkaTekst,
                      !wTymMiesiacu && style.kratkaTekstObcy,
                      zaznaczona && style.kratkaTekstWybrany,
                    ]}
                  >
                    {dzienMiesiaca(dzien)}
                  </Text>
                  <View
                    style={[
                      style.kropka,
                      zWizytami.includes(dzien) && (
                        zaznaczona ? style.kropkaNaWybranym : style.kropkaWidoczna
                      ),
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => wybierz(dzis)}
            accessibilityRole="button"
            style={({ pressed }) => [style.dzisiaj, pressed && style.dzisiajWcisniety]}
          >
            <Text style={style.dzisiajTekst}>Dzis</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const style = StyleSheet.create({
  pasek: {
    backgroundColor: Kolory.powierzchnia,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.obramowanie,
    // Rozwinieta siatka miesiaca ma lezec NA dniu, a nie spychac go w dol.
    zIndex: 5,
  },
  rzad: {
    flexDirection: 'row',
    alignItems: 'center',
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
  srodek: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Zaokraglenia.m,
    paddingVertical: s(2),
  },
  srodekWcisniety: { backgroundColor: Kolory.akcentTlo },
  dzien: { fontSize: s(17), fontWeight: '800', color: Kolory.tekst },
  znacznik: { fontSize: s(13), color: Kolory.tekstSlaby },
  podpis: {
    fontSize: s(11.5),
    fontWeight: '700',
    color: Kolory.akcent,
    letterSpacing: 0.4,
    marginTop: 1,
  },

  miesiac: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: Kolory.powierzchnia,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.obramowanie,
    paddingBottom: Odstepy.s,
    ...cien('mocny'),
  },
  miesiacNazwa: {
    flex: 1,
    textAlign: 'center',
    fontSize: s(15),
    fontWeight: '800',
    color: Kolory.tekstDrugi,
  },
  tydzien: {
    flexDirection: 'row',
    paddingHorizontal: Odstepy.s,
    marginBottom: s(2),
  },
  naglowekDnia: {
    flex: 1,
    textAlign: 'center',
    fontSize: s(11),
    fontWeight: '700',
    color: Kolory.tekstSlaby,
  },
  kratki: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Odstepy.s,
  },
  kratka: {
    width: `${100 / 7}%`,
    height: s(40),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Zaokraglenia.s,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  kratkaDzis: { borderColor: Kolory.akcent },
  kratkaWybrana: { backgroundColor: Kolory.akcent, borderColor: Kolory.akcent },
  kratkaWcisnieta: { backgroundColor: Kolory.akcentTlo },
  kratkaTekst: { fontSize: s(14.5), fontWeight: '700', color: Kolory.tekst },
  kratkaTekstObcy: { color: Kolory.tekstSlaby, fontWeight: '400' },
  kratkaTekstWybrany: { color: Kolory.tekstNaAkcencie },
  kropka: {
    width: s(5),
    height: s(5),
    borderRadius: Zaokraglenia.pelne,
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  kropkaWidoczna: { backgroundColor: Kolory.akcent },
  kropkaNaWybranym: { backgroundColor: Kolory.tekstNaAkcencie },

  dzisiaj: {
    alignSelf: 'center',
    marginTop: Odstepy.xs,
    paddingHorizontal: Odstepy.l,
    paddingVertical: s(8),
    borderRadius: Zaokraglenia.pelne,
    borderWidth: 1,
    borderColor: Kolory.obramowanieMocne,
  },
  dzisiajWcisniety: { backgroundColor: Kolory.akcentTlo },
  dzisiajTekst: { fontSize: s(13), fontWeight: '800', color: Kolory.akcent },
});
