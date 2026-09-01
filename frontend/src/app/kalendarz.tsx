/**
 * KALENDARZ - grafik warsztatu, dzien po dniu.
 *
 * Pokazuje wizyty tak, jak zostaly wpisane: na wysokosci odpowiadajacej
 * godzinom i czasowi trwania, w kolorze swojego statusu. Dotkniecie bloku
 * otwiera zgloszenie, a przycisk na ekranie zgloszenia prowadzi z powrotem
 * tutaj, dokladnie na jego godzine.
 *
 * D1: czyta wylacznie lokalna baze komputera, wiec grafik jest w warsztacie
 * dostepny tak samo bez zasiegu.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import PasekDnia from '../komponenty/PasekDnia';
import SiatkaDnia from '../komponenty/SiatkaDnia';
import { wizytyDnia } from '../dane/repozytorium';
import { Kolory } from '../motyw';
import { dzisiaj, naMinuty } from '../termin';
import type { Wizyta } from '../typy';

/** Gdy dzien jest pusty, widok staje na poczatku dnia pracy. */
const DOMYSLNA_GODZINA = 8 * 60;

export default function EkranKalendarza() {
  const router = useRouter();
  const parametry = useLocalSearchParams<{ data?: string; wizyta?: string }>();
  const wyrozniona = String(parametry.wizyta ?? '') || null;

  const [data, setData] = useState(
    () => String(parametry.data ?? '').slice(0, 10) || dzisiaj(),
  );
  const [wizyty, setWizyty] = useState<Wizyta[]>([]);

  const wczytaj = useCallback(async () => {
    setWizyty(await wizytyDnia(data));
  }, [data]);

  // Odczyt z lokalnej bazy jest natychmiastowy, wiec powtarzamy go przy
  // kazdym wejsciu - takze po powrocie ze zmienionej wizyty.
  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  /* Widok staje na wizycie, z ktorej mechanik tu przyszedl; bez wskazanej -
     na pierwszej wizycie dnia. */
  const przewinDo = useMemo(() => {
    const cel = wizyty.find((w) => w.id === wyrozniona) ?? wizyty[0];
    return cel ? naMinuty(cel.godzina_od) : DOMYSLNA_GODZINA;
  }, [wizyty, wyrozniona]);

  return (
    <View style={style.ekran}>
      <Stack.Screen options={{ title: 'Kalendarz' }} />

      <PasekDnia data={data} onZmiana={setData} />

      <SiatkaDnia
        dzien={data}
        wizyty={wizyty}
        przewinDo={przewinDo}
        wyrozniona={wyrozniona}
        onWizyta={(w) => router.push(`/wizyta/${w.id}`)}
      />
    </View>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
});
