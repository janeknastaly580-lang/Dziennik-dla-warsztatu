/**
 * Edycja danych klienta.
 *
 * B1 - do kolejki trafiaja WYLACZNIE pola, ktore mechanik faktycznie zmienil.
 *      Poprawka numeru telefonu nie cofnie notatki dopisanej w tym samym
 *      czasie przez kolege z drugiego komputera.
 *
 * Przed zapisem pojawia sie pytanie "czy na pewno" z wypisanymi zmianami -
 * mechanik widzi czarno na bialym, co przed chwila poprawil i na co.
 * To tanie zabezpieczenie przed przypadkowa edycja cudzej kartoteki.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import EkranFormularza from '../../komponenty/EkranFormularza';
import { KomunikatFormularza, Pole, Przycisk, Sekcja } from '../../komponenty/Formularz';
import Potwierdzenie from '../../komponenty/Potwierdzenie';
import { Ladowanie } from '../../komponenty/Stany';
import { profilKlienta, zaktualizujKlienta } from '../../dane/repozytorium';
import { odswiezLicznikiKolejki } from '../../dane/synchronizacja';
import { Kolory, Odstepy } from '../../motyw';
import { POLA_KLIENTA, PUSTY_KLIENT, type WartosciKlienta } from '../../polaKlienta';
import { s } from '../../uklad';

type Wartosci = WartosciKlienta;

export default function EkranEdycjiKlienta() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const klientId = String(id ?? '');

  const [poczatkowe, setPoczatkowe] = useState<Wartosci | null>(null);
  const [wartosci, setWartosci] = useState<Wartosci>(PUSTY_KLIENT);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [pytanie, setPytanie] = useState(false);

  useEffect(() => {
    let aktywny = true;
    profilKlienta(klientId).then((k) => {
      if (!aktywny) return;
      if (!k) {
        setBlad('Nie znaleziono tej kartoteki na komputerze.');
        return;
      }
      const dane: Wartosci = {
        nazwa: k.nazwa ?? '', telefon: k.telefon ?? '', email: k.email ?? '',
        adres: k.adres ?? '', nip: k.nip ?? '', notatki: k.notatki ?? '',
      };
      setPoczatkowe(dane);
      setWartosci(dane);
    });
    return () => { aktywny = false; };
  }, [klientId]);

  /** Lista zmian do pokazania w pytaniu "czy na pewno". */
  const zmiany = useMemo(() => {
    if (!poczatkowe) return [];
    return POLA_KLIENTA
      .filter((pole) => wartosci[pole.klucz].trim() !== poczatkowe[pole.klucz].trim())
      .map((pole) => ({
        etykieta: pole.etykieta,
        z: poczatkowe[pole.klucz].trim() || '(puste)',
        na: wartosci[pole.klucz].trim() || '(puste)',
      }));
  }, [poczatkowe, wartosci]);

  const sprobujZapisac = useCallback(() => {
    if (!wartosci.nazwa.trim()) {
      setBlad('Nazwa klienta nie moze byc pusta.');
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
      await zaktualizujKlienta(klientId, {
        nazwa: wartosci.nazwa, telefon: wartosci.telefon, email: wartosci.email,
        adres: wartosci.adres, nip: wartosci.nip, notatki: wartosci.notatki,
      });
      await odswiezLicznikiKolejki();
      if (router.canGoBack()) router.back();
      else router.replace(`/klient/${klientId}`);
    } catch (err) {
      setBlad(err instanceof Error ? err.message : 'Nie udalo sie zapisac zmian.');
      setZapisywanie(false);
    }
  }, [klientId, wartosci, router]);

  if (!poczatkowe) {
    return (
      <View style={style.ekran}>
        <Stack.Screen options={{ title: 'Edycja klienta' }} />
        {blad
          ? <Text style={style.blad}>{blad}</Text>
          : <Ladowanie tekst="Wczytywanie kartoteki..." />}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edycja klienta' }} />
      <EkranFormularza>
        <KomunikatFormularza tresc={blad} />

        <Sekcja tytul="DANE KLIENTA">
          {POLA_KLIENTA.map((pole) => (
            <Pole
              key={pole.klucz}
              etykieta={pole.etykieta}
              wymagane={'wymagane' in pole ? pole.wymagane : undefined}
              value={wartosci[pole.klucz]}
              onChangeText={(t) => setWartosci((w) => ({ ...w, [pole.klucz]: t }))}
              keyboardType={'klawiatura' in pole ? pole.klawiatura : undefined}
              autoCapitalize={'bezWielkichLiter' in pole ? 'none' : 'sentences'}
              multiline={'wiele' in pole ? pole.wiele : undefined}
            />
          ))}
        </Sekcja>

        <Text style={style.podpowiedz}>
          {zmiany.length
            ? `Zmienione pola: ${zmiany.length}. Przed zapisem pokazemy je do potwierdzenia.`
            : 'Popraw to, co trzeba - dopoki nic nie zmienisz, przycisk zapisu nic nie zrobi.'}
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
  podpowiedz: {
    fontSize: s(12.5), color: Kolory.tekstSlaby, lineHeight: s(18), marginBottom: Odstepy.m,
  },
  przyciski: { gap: Odstepy.s },
  blad: { padding: Odstepy.l, fontSize: s(14), color: Kolory.blad },
});
