/**
 * WIDOK GLOWNY - lista klientow.
 *
 *  1. Po wejsciu od razu widac PELNA liste klientow - bez klikania i bez
 *     czekania na siec. Dane sa czytane z lokalnej bazy komputera (D1).
 *  2. Pole wyszukiwania filtruje NA ZYWO, po kazdej literze.
 *  3. Przycisk "Dodaj" jest widoczny, ale odsuniety od srodka - siedzi
 *     w prawym gornym rogu paska nawigacji.
 *  4. Plakietka "N otwartych usterek" prowadzi na ekran zbiorczy, a ikona
 *     kalendarza w prawym gornym rogu - na grafik warsztatu.
 *  5. D4/D5: nad lista stoi pasek z wiekiem danych i licznikiem zmian
 *     czekajacych na wyslanie.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import KafelekKlienta from '../komponenty/KafelekKlienta';
import PoleWyszukiwania from '../komponenty/PoleWyszukiwania';
import { Ladowanie, Pusto } from '../komponenty/Stany';
import { listaKlientow } from '../dane/repozytorium';
import { useAplikacja } from '../dane/kontekst';
import { doPorownania, odmiana } from '../format';
import { Kolory, Odstepy, Zaokraglenia } from '../motyw';
import {
  SZEROKOSC_TRESCI, dopelnijWiersz, kolumnyKafelkow, pewneWymiary, s, wys,
} from '../uklad';
import type { KlientNaLiscie } from '../typy';

/**
 * Ikona kalendarza narysowana samymi widokami - projekt swiadomie nie ma
 * biblioteki ikon (tak samo jak oko przy polu hasla w `Formularz.tsx`).
 */
function IkonaKalendarza() {
  return (
    <View style={style.ikonaRamka}>
      <View style={style.ikonaGrzbiet} />
      <View style={style.ikonaDni}>
        <View style={style.ikonaDzien} />
        <View style={style.ikonaDzien} />
        <View style={style.ikonaDzien} />
        <View style={style.ikonaDzien} />
      </View>
    </View>
  );
}

export default function EkranListyKlientow() {
  const router = useRouter();
  // Na szerokim oknie kafelki ida obok siebie - jeden slup kartotek przez
  // srodek monitora marnowalby cala reszte ekranu.
  const { width } = pewneWymiary(useWindowDimensions());
  const kolumny = kolumnyKafelkow(width);
  const { synchronizuj, czyAdministrator } = useAplikacja();

  const [klienci, setKlienci] = useState<KlientNaLiscie[]>([]);
  const [fraza, setFraza] = useState('');
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);

  const wczytaj = useCallback(async () => {
    setKlienci(await listaKlientow());
    setLadowanie(false);
  }, []);

  // Odczyt z lokalnej bazy jest natychmiastowy, wiec robimy go przy kazdym
  // wejsciu na ekran - takze po dodaniu klienta czy zmianie statusu.
  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  /** Pociagniecie listy w dol = "sprobuj dogonic serwer teraz". */
  const odswiez = useCallback(async () => {
    setOdswiezanie(true);
    await synchronizuj({ wymuszona: true });
    await wczytaj();
    setOdswiezanie(false);
  }, [synchronizuj, wczytaj]);

  /* ----------------------- FILTR NA ZYWO ----------------------- */
  const widoczni = useMemo(() => {
    const czesci = fraza.split(/\s+/).map(doPorownania).filter(Boolean);
    if (!czesci.length) return klienci;

    return klienci.filter((k) => {
      // "auta" to sklejone opisy pojazdow z wizyt tego klienta - dzieki temu
      // wyszukiwarka znajduje klienta po numerze rejestracyjnym.
      const stog = doPorownania(
        [k.nazwa, k.telefon, k.email, k.adres, k.auta].filter(Boolean).join(' '),
      );
      return czesci.every((czesc) => stog.includes(czesc));
    });
  }, [klienci, fraza]);

  const filtrowanie = fraza.trim().length > 0;
  const otwarteRazem = useMemo(
    () => klienci.reduce((suma, k) => suma + (k.liczba_otwartych ?? 0), 0),
    [klienci],
  );

  const naglowekEkranu = (
    <Stack.Screen
      options={{
        title: 'Klienci',
        headerLeft: () => (
          <View style={style.lewaStrona}>
            <Pressable
              onPress={() => router.push('/ustawienia')}
              hitSlop={10}
              accessibilityLabel="Aplikacja i synchronizacja"
              style={style.przyciskUstawien}
            >
              <Text style={style.ikonaUstawien}>{'⚙'}</Text>
            </Pressable>
            {/* Jedyna roznica w interfejsie miedzy administratorem
                a mechanikiem: ten jeden przycisk. */}
            {czyAdministrator ? (
              <Pressable
                onPress={() => router.push('/administracja')}
                hitSlop={10}
                accessibilityLabel="Zarzadzanie dostepem mechanikow"
                style={style.przyciskUstawien}
              >
                <Text style={style.ikonaUstawien}>{'⚿'}</Text>
              </Pressable>
            ) : null}
          </View>
        ),
        headerRight: () => (
          <View style={style.prawaStrona}>
            <Pressable
              onPress={() => router.push('/kalendarz')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Kalendarz wizyt"
              style={({ pressed }) => [style.przyciskKalendarza, pressed && style.wcisniety]}
            >
              <IkonaKalendarza />
            </Pressable>
            <Pressable
              onPress={() => router.push('/klient/nowy')}
              accessibilityLabel="Dodaj nowego klienta"
              style={({ pressed }) => [
                style.przyciskDodaj, pressed && style.przyciskDodajWcisniety,
              ]}
            >
              <Text style={style.przyciskDodajTekst}>+ Dodaj</Text>
            </Pressable>
          </View>
        ),
      }}
    />
  );

  if (ladowanie) {
    return (
      <View style={style.ekran}>
        {naglowekEkranu}
        <Ladowanie tekst="Wczytywanie listy klientow..." />
      </View>
    );
  }

  return (
    <View style={style.ekran}>
      {naglowekEkranu}

      <View style={style.gora}>
        <View style={style.goraTresc}>
        <PoleWyszukiwania wartosc={fraza} onZmiana={setFraza} />

        <View style={style.pasekInformacji}>
          <Text style={style.informacja}>
            {filtrowanie
              ? `Pasuje ${widoczni.length} z ${klienci.length}`
              : `Wszyscy klienci: ${klienci.length}`}
          </Text>
          {otwarteRazem > 0 && !filtrowanie ? (
            <Pressable
              onPress={() => router.push('/usterki')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Pokaz wszystkie otwarte usterki: ${otwarteRazem}`}
              style={({ pressed }) => [style.plakietka, pressed && style.plakietkaWcisnieta]}
            >
              <Text style={style.plakietkaTekst}>
                {otwarteRazem}{' '}
                {odmiana(otwarteRazem, 'otwarta usterka', 'otwarte usterki', 'otwartych usterek')}
                {' ›'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        </View>
      </View>

      <FlatList
        data={dopelnijWiersz(widoczni, kolumny)}
        keyExtractor={(k, i) => k?.id ?? `pusty-${i}`}
        // Zmiana liczby kolumn wymaga nowej listy - stad klucz.
        key={`kolumny-${kolumny}`}
        numColumns={kolumny}
        columnWrapperStyle={kolumny > 1 ? style.wiersz : undefined}
        renderItem={({ item }) => (
          <View style={style.komorka}>
            {item ? (
              <KafelekKlienta klient={item} onPress={() => router.push(`/klient/${item.id}`)} />
            ) : null}
          </View>
        )}
        contentContainerStyle={style.lista}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={odswiezanie}
            onRefresh={odswiez}
            colors={[Kolory.akcent]}
            tintColor={Kolory.akcent}
          />
        }
        ListEmptyComponent={
          filtrowanie ? (
            <Pusto
              tytul="Brak wynikow"
              opis={`Zaden klient nie pasuje do "${fraza}". Wyczysc pole, aby zobaczyc pelna liste.`}
            />
          ) : (
            <Pusto
              tytul="Baza klientow jest pusta"
              opis={'Uzyj przycisku "+ Dodaj" w prawym gornym rogu albo pociagnij liste '
                + 'w dol, zeby pobrac dane z serwera.'}
            />
          )
        }
      />
    </View>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  // Pasek wyszukiwania trzyma te sama szerokosc co siatka kafelkow ponizej.
  goraTresc: { width: '100%', maxWidth: SZEROKOSC_TRESCI, alignSelf: 'center' },
  gora: {
    paddingHorizontal: Odstepy.l,
    paddingTop: Odstepy.m,
    paddingBottom: Odstepy.s,
    backgroundColor: Kolory.powierzchnia,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.obramowanie,
  },
  pasekInformacji: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Odstepy.s,
    minHeight: 22,
  },
  informacja: { fontSize: s(12.5), fontWeight: '600', color: Kolory.tekstSlaby },
  plakietka: {
    backgroundColor: Kolory.pilneTlo,
    borderWidth: 1,
    borderColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: Odstepy.s,
    paddingVertical: 2,
  },
  plakietkaWcisnieta: { opacity: 0.7 },
  plakietkaTekst: { fontSize: s(11), fontWeight: '800', color: Kolory.pilne },
  wiersz: { gap: Odstepy.m, alignItems: 'flex-start' },
  komorka: { flex: 1, minWidth: 0 },
  lista: {
    width: '100%',
    maxWidth: SZEROKOSC_TRESCI,
    alignSelf: 'center',
    padding: Odstepy.l,
    // Zapas na dole - ostatni klient nie chowa sie pod paskiem gestow.
    paddingBottom: wys(6, 32),
  },
  przyciskDodaj: {
    backgroundColor: Kolory.akcent,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: s(14),
    paddingVertical: s(8),
  },
  przyciskDodajWcisniety: { backgroundColor: Kolory.akcentCiemny },
  przyciskDodajTekst: { color: Kolory.tekstNaAkcencie, fontSize: s(14), fontWeight: '800' },
  lewaStrona: { flexDirection: 'row', alignItems: 'center' },
  prawaStrona: { flexDirection: 'row', alignItems: 'center', gap: Odstepy.s },
  przyciskKalendarza: {
    padding: Odstepy.xs,
    borderRadius: Zaokraglenia.s,
  },
  wcisniety: { backgroundColor: Kolory.akcentTlo },
  ikonaRamka: {
    width: s(21),
    height: s(20),
    borderWidth: s(1.6),
    borderColor: Kolory.tekstDrugi,
    borderRadius: s(4),
    overflow: 'hidden',
    paddingHorizontal: s(2),
  },
  ikonaGrzbiet: {
    height: s(4),
    marginHorizontal: -s(2),
    backgroundColor: Kolory.tekstDrugi,
    marginBottom: s(2.5),
  },
  ikonaDni: { flexDirection: 'row', flexWrap: 'wrap', gap: s(1.6) },
  ikonaDzien: {
    width: s(3.4),
    height: s(3.4),
    backgroundColor: Kolory.tekstDrugi,
    borderRadius: s(1),
  },
  przyciskUstawien: { paddingHorizontal: Odstepy.xs },
  ikonaUstawien: { fontSize: s(20), color: Kolory.tekstDrugi },
});
