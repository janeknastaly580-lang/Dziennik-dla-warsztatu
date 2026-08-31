/**
 * EKRAN OTWARTYCH USTEREK - wszystkie niezamkniete zgloszenia z calej bazy.
 *
 * Wchodzi sie tu plakietka "N otwartych usterek" z listy klientow.
 *
 *  1. Po wejsciu widac PELNA liste otwartych usterek - z lokalnej bazy,
 *     wiec takze bez zasiegu.
 *  2. Dwa przyciski - "W trakcie" i "Nie naprawione" - zawezaja liste.
 *     Ponowne dotkniecie aktywnego przycisku zdejmuje filtr.
 *  3. KOLEJNOSC: im wyzszy priorytet, tym wyzej. Przy rownym priorytecie
 *     nienaprawione przed "w trakcie", a na koncu nowsza data wizyty.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import KafelekWizyty from '../komponenty/KafelekWizyty';
import { Ladowanie, Pusto } from '../komponenty/Stany';
import { otwarteUsterki } from '../dane/repozytorium';
import { useAplikacja } from '../dane/kontekst';
import { odmiana } from '../format';
import { Kolory, Odstepy, Zaokraglenia, wagaPriorytetu } from '../motyw';
import { CEL_DOTYKU, s, wys } from '../uklad';
import type { Wizyta } from '../typy';

/** Filtr statusu; null = pelna lista otwartych usterek. */
type Filtr = 'nienaprawione' | 'w_trakcie' | null;

/** Przy rownym priorytecie nienaprawione stoi nad tym, co juz w robocie. */
const KOLEJNOSC_STATUSU: Record<string, number> = {
  nienaprawione: 0,
  w_trakcie: 1,
  naprawione: 2,
};

export default function EkranOtwartychUsterek() {
  const router = useRouter();
  const { synchronizuj } = useAplikacja();

  const [usterki, setUsterki] = useState<Wizyta[]>([]);
  const [filtr, setFiltr] = useState<Filtr>(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);

  const wczytaj = useCallback(async () => {
    setUsterki(await otwarteUsterki());
    setLadowanie(false);
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  const odswiez = useCallback(async () => {
    setOdswiezanie(true);
    await synchronizuj({ wymuszona: true });
    await wczytaj();
    setOdswiezanie(false);
  }, [synchronizuj, wczytaj]);

  /* ------------- SORTOWANIE: najwyzszy priorytet na gorze ------------- */
  const posortowane = useMemo(
    () => [...usterki].sort((a, b) => {
      const priorytet = wagaPriorytetu(b.priorytet) - wagaPriorytetu(a.priorytet);
      if (priorytet !== 0) return priorytet;

      const status = (KOLEJNOSC_STATUSU[a.status] ?? 0) - (KOLEJNOSC_STATUSU[b.status] ?? 0);
      if (status !== 0) return status;

      const data = String(b.data_wizyty).localeCompare(String(a.data_wizyty));
      return data !== 0 ? data : String(b.zrobione_o ?? '').localeCompare(String(a.zrobione_o ?? ''));
    }),
    [usterki],
  );

  const widoczne = useMemo(
    () => (filtr ? posortowane.filter((w) => w.status === filtr) : posortowane),
    [posortowane, filtr],
  );

  const liczby = useMemo(
    () => ({
      nienaprawione: usterki.filter((w) => w.status === 'nienaprawione').length,
      w_trakcie: usterki.filter((w) => w.status === 'w_trakcie').length,
    }),
    [usterki],
  );

  /** Kliniecie aktywnego przycisku zdejmuje filtr - wraca pelna lista. */
  const przelacz = useCallback(
    (wybrany: Exclude<Filtr, null>) =>
      setFiltr((obecny) => (obecny === wybrany ? null : wybrany)),
    [],
  );

  const naglowekEkranu = <Stack.Screen options={{ title: 'Otwarte usterki' }} />;

  if (ladowanie) {
    return (
      <View style={style.ekran}>
        {naglowekEkranu}
        <Ladowanie tekst="Wczytywanie usterek..." />
      </View>
    );
  }

  return (
    <View style={style.ekran}>
      {naglowekEkranu}

      <View style={style.gora}>
        <View style={style.filtry}>
          <PrzyciskFiltra
            etykieta="W trakcie"
            licznik={liczby.w_trakcie}
            kolor={Kolory.wTrakcie}
            aktywny={filtr === 'w_trakcie'}
            onPress={() => przelacz('w_trakcie')}
          />
          <PrzyciskFiltra
            etykieta="Nie naprawione"
            licznik={liczby.nienaprawione}
            kolor={Kolory.pilne}
            aktywny={filtr === 'nienaprawione'}
            onPress={() => przelacz('nienaprawione')}
          />
        </View>

        <Text style={style.informacja}>
          {filtr
            ? `Pokazane ${widoczne.length} z ${usterki.length}  ·  dotknij ponownie, aby pokazac wszystkie`
            : `Wszystkie otwarte: ${usterki.length} ${odmiana(usterki.length, 'usterka', 'usterki', 'usterek')}`
              + '  ·  najwyzszy priorytet na gorze'}
        </Text>
      </View>

      <FlatList
        data={widoczne}
        keyExtractor={(w) => w.id}
        renderItem={({ item }) => (
          <KafelekWizyty
            wizyta={item}
            klient={item.klient_nazwa}
            onPress={() => router.push(`/wizyta/${item.id}`)}
          />
        )}
        contentContainerStyle={style.lista}
        refreshControl={
          <RefreshControl
            refreshing={odswiezanie}
            onRefresh={odswiez}
            colors={[Kolory.akcent]}
            tintColor={Kolory.akcent}
          />
        }
        ListEmptyComponent={
          filtr ? (
            <Pusto
              tytul="Brak usterek w tym statusie"
              opis="Dotknij aktywnego przycisku jeszcze raz, aby zobaczyc wszystkie otwarte usterki."
            />
          ) : (
            <Pusto tytul="Brak otwartych usterek" opis="Wszystkie zgloszenia sa naprawione." />
          )
        }
      />
    </View>
  );
}

/* ===================================================================== */

function PrzyciskFiltra({
  etykieta, licznik, kolor, aktywny, onPress,
}: {
  etykieta: string;
  licznik: number;
  kolor: string;
  aktywny: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: aktywny }}
      accessibilityLabel={`${etykieta}: ${licznik}`}
      style={({ pressed }) => [
        style.filtr,
        aktywny && { backgroundColor: kolor, borderColor: kolor },
        pressed && style.filtrWcisniety,
      ]}
    >
      <Text
        style={[style.filtrTekst, aktywny ? style.filtrTekstAktywny : { color: kolor }]}
        numberOfLines={1}
      >
        {etykieta}
      </Text>
      <View style={[style.filtrLicznik, aktywny && style.filtrLicznikAktywny]}>
        <Text style={[style.filtrLicznikTekst, aktywny ? style.filtrTekstAktywny : { color: kolor }]}>
          {licznik}
        </Text>
      </View>
    </Pressable>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  gora: {
    paddingHorizontal: Odstepy.l,
    paddingTop: Odstepy.m,
    paddingBottom: Odstepy.s,
    backgroundColor: Kolory.powierzchnia,
    borderBottomWidth: 1,
    borderBottomColor: Kolory.obramowanie,
  },
  filtry: { flexDirection: 'row', gap: Odstepy.s },
  filtr: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: Odstepy.m,
    minHeight: CEL_DOTYKU,
  },
  filtrWcisniety: { opacity: 0.75 },
  filtrTekst: { fontSize: s(14), fontWeight: '800', flexShrink: 1 },
  filtrTekstAktywny: { color: Kolory.tekstNaAkcencie },
  filtrLicznik: {
    minWidth: s(22),
    alignItems: 'center',
    backgroundColor: Kolory.powierzchniaStonowana,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  filtrLicznikAktywny: { backgroundColor: 'rgba(255,255,255,0.25)' },
  filtrLicznikTekst: { fontSize: s(11), fontWeight: '800' },
  informacja: {
    fontSize: s(12.5), fontWeight: '600', color: Kolory.tekstSlaby, marginTop: Odstepy.s,
  },
  lista: { padding: Odstepy.l, paddingBottom: wys(6, 32) },
});
