/**
 * Edycja zgloszenia.
 *
 * B1 - do kolejki trafiaja WYLACZNIE zmienione kolumny. Poprawka opisu nie
 *      cofnie statusu, ktory w tym czasie ustawil kolega z drugiego komputera.
 *
 * Statusu NIE zmienia sie tutaj - od tego sa trzy duze przyciski na ekranie
 * zgloszenia. Tu poprawia sie tresc: auto, tytul, opis, priorytet, termin,
 * przebieg i koszt. Rozdzielenie tych dwoch rzeczy trzyma karencje usuwania
 * (30 dni od oznaczenia jako naprawione) w jednym, przewidywalnym miejscu.
 *
 * Przed zapisem pojawia sie pytanie "czy na pewno" z lista zmian.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import EkranFormularza from '../../komponenty/EkranFormularza';
import {
  KomunikatFormularza, Pole, Przycisk, Sekcja, WyborOpcji,
} from '../../komponenty/Formularz';
import Potwierdzenie from '../../komponenty/Potwierdzenie';
import WierszTerminu, { KalendarzTerminu } from '../../komponenty/WyborTerminu';
import { Ladowanie } from '../../komponenty/Stany';
import { pobierzWizyte, zaktualizujWizyte } from '../../dane/repozytorium';
import { odswiezLicznikiKolejki } from '../../dane/synchronizacja';
import { Kolory, Odstepy } from '../../motyw';
import {
  type Termin, domyslnyTermin, dzisiaj, formatujTermin, takiSam, terminWizyty,
} from '../../termin';
import { s } from '../../uklad';
import type { Priorytet } from '../../typy';

const PRIORYTETY: { wartosc: Priorytet; etykieta: string; kolor?: string }[] = [
  { wartosc: 'niski', etykieta: 'Niski' },
  { wartosc: 'normalny', etykieta: 'Normalny' },
  { wartosc: 'wysoki', etykieta: 'Wysoki', kolor: Kolory.pilne },
];

const ETYKIETY_PRIORYTETU: Record<string, string> = {
  niski: 'Niski', normalny: 'Normalny', wysoki: 'Wysoki',
};

type Wartosci = {
  auto: string; tytul: string; opis: string;
  priorytet: Priorytet; termin: Termin; przebieg: string; koszt: string;
};

/** Stan przed wczytaniem wizyty - ekran pokazuje wtedy kreciolek. */
const puste = (): Wartosci => ({
  auto: '', tytul: '', opis: '', priorytet: 'normalny',
  termin: domyslnyTermin(), przebieg: '', koszt: '',
});

/** Przecinek jako separator dziesietny - tak sie pisze kwoty po polsku. */
const naLiczbe = (t: string): number | null => {
  const czyste = t.trim().replace(/\s/g, '').replace(',', '.');
  if (!czyste) return null;
  const n = Number(czyste);
  return Number.isFinite(n) ? n : null;
};

export default function EkranEdycjiWizyty() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wizytaId = String(id ?? '');

  const [poczatkowe, setPoczatkowe] = useState<Wartosci | null>(null);
  const [wartosci, setWartosci] = useState<Wartosci>(puste);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [pytanie, setPytanie] = useState(false);
  const [kalendarz, setKalendarz] = useState(false);

  useEffect(() => {
    let aktywny = true;
    pobierzWizyte(wizytaId).then((w) => {
      if (!aktywny) return;
      if (!w) {
        setBlad('Nie znaleziono tego zgloszenia na komputerze.');
        return;
      }
      const dane: Wartosci = {
        auto: w.auto ?? '',
        tytul: w.tytul ?? '',
        opis: w.opis ?? '',
        priorytet: w.priorytet ?? 'normalny',
        // Wizyty zalozone przed kalendarzem nie maja godzin - podsuwamy
        // domyslne w ich dniu, ale zapisuja sie dopiero, gdy ktos je ruszy.
        termin: terminWizyty(w)
          ?? domyslnyTermin(String(w.data_wizyty ?? '').slice(0, 10) || dzisiaj()),
        przebieg: w.przebieg === null || w.przebieg === undefined ? '' : String(w.przebieg),
        koszt: w.koszt === null || w.koszt === undefined
          ? '' : String(w.koszt).replace('.', ','),
      };
      setPoczatkowe(dane);
      setWartosci(dane);
    });
    return () => { aktywny = false; };
  }, [wizytaId]);

  const zmiany = useMemo(() => {
    if (!poczatkowe) return [];
    const opis: { etykieta: string; z: string; na: string }[] = [];
    const dodaj = (etykieta: string, z: string, na: string) => {
      if (z.trim() !== na.trim()) {
        opis.push({ etykieta, z: z.trim() || '(puste)', na: na.trim() || '(puste)' });
      }
    };
    dodaj('Auto', poczatkowe.auto, wartosci.auto);
    dodaj('Tytul', poczatkowe.tytul, wartosci.tytul);
    dodaj('Opis', poczatkowe.opis, wartosci.opis);
    if (poczatkowe.priorytet !== wartosci.priorytet) {
      opis.push({
        etykieta: 'Priorytet',
        z: ETYKIETY_PRIORYTETU[poczatkowe.priorytet],
        na: ETYKIETY_PRIORYTETU[wartosci.priorytet],
      });
    }
    if (!takiSam(poczatkowe.termin, wartosci.termin)) {
      opis.push({
        etykieta: 'Termin',
        z: formatujTermin(poczatkowe.termin),
        na: formatujTermin(wartosci.termin),
      });
    }
    dodaj('Przebieg', poczatkowe.przebieg, wartosci.przebieg);
    dodaj('Koszt', poczatkowe.koszt, wartosci.koszt);
    return opis;
  }, [poczatkowe, wartosci]);

  const sprobujZapisac = useCallback(() => {
    if (!wartosci.tytul.trim()) {
      setBlad('Tytul zgloszenia nie moze byc pusty.');
      return;
    }
    if (wartosci.przebieg.trim() && naLiczbe(wartosci.przebieg) === null) {
      setBlad('Przebieg musi byc liczba.');
      return;
    }
    if (wartosci.koszt.trim() && naLiczbe(wartosci.koszt) === null) {
      setBlad('Koszt musi byc liczba, np. 450 albo 450,50.');
      return;
    }
    if (!zmiany.length) {
      setBlad('Nic sie nie zmienilo.');
      return;
    }
    setBlad(null);
    setPytanie(true);
  }, [wartosci, zmiany]);

  const zapisz = useCallback(async () => {
    setPytanie(false);
    setZapisywanie(true);
    try {
      await zaktualizujWizyte(wizytaId, {
        auto: wartosci.auto,
        tytul: wartosci.tytul,
        opis: wartosci.opis,
        priorytet: wartosci.priorytet,
        data_wizyty: wartosci.termin.data,
        godzina_od: wartosci.termin.godzinaOd,
        godzina_do: wartosci.termin.godzinaDo,
        przebieg: naLiczbe(wartosci.przebieg),
        koszt: naLiczbe(wartosci.koszt),
      });
      await odswiezLicznikiKolejki();
      if (router.canGoBack()) router.back();
      else router.replace(`/wizyta/${wizytaId}`);
    } catch (err) {
      setBlad(err instanceof Error ? err.message : 'Nie udalo sie zapisac zmian.');
      setZapisywanie(false);
    }
  }, [wizytaId, wartosci, router]);

  if (!poczatkowe) {
    return (
      <View style={style.ekran}>
        <Stack.Screen options={{ title: 'Edycja zgloszenia' }} />
        {blad
          ? <Text style={style.blad}>{blad}</Text>
          : <Ladowanie tekst="Wczytywanie zgloszenia..." />}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edycja zgloszenia' }} />
      <EkranFormularza>
        <KomunikatFormularza tresc={blad} />

        <Sekcja tytul="AUTO">
          <Pole
            etykieta="Jakie to auto / wazna uwaga"
            value={wartosci.auto}
            onChangeText={(t) => setWartosci((w) => ({ ...w, auto: t }))}
            multiline
            style={style.poleAuta}
          />
        </Sekcja>

        <Sekcja tytul="ZGLOSZENIE">
          <Pole
            etykieta="Tytul wizyty"
            wymagane
            value={wartosci.tytul}
            onChangeText={(t) => setWartosci((w) => ({ ...w, tytul: t }))}
          />
          <Pole
            etykieta="Opis"
            value={wartosci.opis}
            onChangeText={(t) => setWartosci((w) => ({ ...w, opis: t }))}
            multiline
          />
          <WyborOpcji
            etykieta="Priorytet"
            opcje={PRIORYTETY}
            wybrana={wartosci.priorytet}
            onWybor={(p) => setWartosci((w) => ({ ...w, priorytet: p }))}
          />
        </Sekcja>

        <Sekcja tytul="TERMIN">
          <WierszTerminu
            wartosc={wartosci.termin}
            onNacisnij={() => setKalendarz(true)}
          />
        </Sekcja>

        <Sekcja tytul="ROZLICZENIE">
          <Pole
            etykieta="Przebieg (km)"
            value={wartosci.przebieg}
            onChangeText={(t) => setWartosci((w) => ({ ...w, przebieg: t }))}
            keyboardType="number-pad"
            placeholder="np. 214000"
          />
          <Pole
            etykieta="Koszt (zl)"
            value={wartosci.koszt}
            onChangeText={(t) => setWartosci((w) => ({ ...w, koszt: t }))}
            keyboardType="decimal-pad"
            placeholder="np. 450,50"
          />
        </Sekcja>

        <Text style={style.podpowiedz}>
          Status zmieniasz na ekranie zgloszenia, trzema duzymi przyciskami.
          Tutaj poprawiasz tresc.
        </Text>

        <View style={style.przyciski}>
          <Przycisk tytul="Zapisz zmiany" onPress={sprobujZapisac} zajety={zapisywanie} />
          <Przycisk
            tytul="Anuluj"
            wariant="drugi"
            onPress={() => router.back()}
            wylaczony={zapisywanie}
          />
        </View>
      </EkranFormularza>

      {/* Kalendarz stoi OBOK formularza - patrz WyborTerminu.tsx. */}
      {kalendarz ? (
        <KalendarzTerminu
          wartosc={wartosci.termin}
          pomijanaWizyta={wizytaId}
          onGotowe={(t) => { setWartosci((w) => ({ ...w, termin: t })); setKalendarz(false); }}
          onAnuluj={() => setKalendarz(false)}
        />
      ) : null}

      {pytanie ? (
        <Potwierdzenie
          widoczne
          tytul="Zapisac zmiany?"
          tresc={zmiany.map((z) => `${z.etykieta}:\n   ${z.z}  →  ${z.na}`).join('\n\n')}
          tekstAkcji="Tak, zapisz"
          tekstAnuluj="Wroc do edycji"
          onAkcja={zapisz}
          onAnuluj={() => setPytanie(false)}
        />
      ) : null}
    </>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  poleAuta: { minHeight: s(76) },
  podpowiedz: {
    fontSize: s(12.5), color: Kolory.tekstSlaby, lineHeight: s(18), marginBottom: Odstepy.m,
  },
  przyciski: { gap: Odstepy.s },
  blad: { padding: Odstepy.l, fontSize: s(14), color: Kolory.blad },
});
