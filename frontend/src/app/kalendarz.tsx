/**
 * KALENDARZ - grafik warsztatu, cztery dni naraz.
 *
 * Pokazuje wizyty tak, jak zostaly wpisane: w kolumnie swojego dnia, na
 * wysokosci odpowiadajacej godzinom i czasowi trwania, w kolorze swojego
 * statusu. Dotkniecie bloku otwiera zgloszenie, a przycisk na ekranie
 * zgloszenia prowadzi z powrotem tutaj, dokladnie na jego godzine.
 *
 * Strzalki w pasku przesuwaja CALY widok o cztery dni - tyle, ile widac
 * naraz, wiec kolejne klikniecia przechodza przez grafik bez powtarzania
 * tych samych dni. Dotkniecie zakresu rozwija siatke miesiaca i pozwala
 * skoczyc na dowolna date.
 *
 * D1: czyta wylacznie lokalna baze komputera, wiec grafik jest w warsztacie
 * dostepny tak samo bez zasiegu.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import PasekDnia from '../komponenty/PasekDnia';
import SiatkaDni, { DNI_W_WIDOKU } from '../komponenty/SiatkaDni';
import { wizytyZakresu } from '../dane/repozytorium';
import { Kolory } from '../motyw';
import { dzisiaj, kolejneDni, naMinuty } from '../termin';
import type { Wizyta } from '../typy';

/** Gdy w widoku nie ma zadnej wizyty, widok staje na poczatku dnia pracy. */
const DOMYSLNA_GODZINA = 8 * 60;

export default function EkranKalendarza() {
  const router = useRouter();
  const parametry = useLocalSearchParams<{ data?: string; wizyta?: string }>();
  const wyrozniona = String(parametry.wizyta ?? '') || null;

  /* Pierwszy dzien widoku. Wejscie z ekranu zgloszenia ustawia go na dzien
     tej wizyty, zeby byla widoczna od razu. */
  const [poczatek, setPoczatek] = useState(
    () => String(parametry.data ?? '').slice(0, 10) || dzisiaj(),
  );
  const [wizyty, setWizyty] = useState<Wizyta[]>([]);

  const dni = useMemo(() => kolejneDni(poczatek, DNI_W_WIDOKU), [poczatek]);
  const ostatni = dni[dni.length - 1];

  const wczytaj = useCallback(async () => {
    setWizyty(await wizytyZakresu(dni[0], ostatni));
  }, [dni, ostatni]);

  // Odczyt z lokalnej bazy jest natychmiastowy, wiec powtarzamy go przy
  // kazdym wejsciu - takze po powrocie ze zmienionej wizyty.
  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  /* Widok staje na wizycie, z ktorej mechanik tu przyszedl; bez wskazanej -
     na pierwszej wizycie z tych czterech dni. */
  const przewinDo = useMemo(() => {
    const cel = wizyty.find((w) => w.id === wyrozniona) ?? wizyty[0];
    return cel ? naMinuty(cel.godzina_od) : DOMYSLNA_GODZINA;
  }, [wizyty, wyrozniona]);

  return (
    <View style={style.ekran}>
      <Stack.Screen options={{ title: 'Kalendarz' }} />

      <PasekDnia
        data={poczatek}
        doData={ostatni}
        krok={DNI_W_WIDOKU}
        onZmiana={setPoczatek}
      />

      <SiatkaDni
        dni={dni}
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
