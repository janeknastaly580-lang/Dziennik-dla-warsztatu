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
import { s } from '../../uklad';

const POLA = [
  { klucz: 'nazwa', etykieta: 'Imie i nazwisko / nazwa firmy', wymagane: true },
  { klucz: 'telefon', etykieta: 'Telefon', klawiatura: 'phone-pad' as const },
  { klucz: 'email', etykieta: 'E-mail', klawiatura: 'email-address' as const },
  { klucz: 'adres', etykieta: 'Adres' },
  { klucz: 'nip', etykieta: 'NIP (firma)', klawiatura: 'number-pad' as const },
  { klucz: 'notatki', etykieta: 'Notatki', wiele: true },
] as const;

type Klucz = (typeof POLA)[number]['klucz'];
type Wartosci = Record<Klucz, string>;

const PUSTE: Wartosci = { nazwa: '', telefon: '', email: '', adres: '', nip: '', notatki: '' };

export default function EkranEdycjiKlienta() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const klientId = String(id ?? '');

  const [poczatkowe, setPoczatkowe] = useState<Wartosci | null>(null);
  const [wartosci, setWartosci] = useState<Wartosci>(PUSTE);
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
    return POLA
      .filter((p) => wartosci[p.klucz].trim() !== poczatkowe[p.klucz].trim())
      .map((p) => ({
        etykieta: p.etykieta,
        z: poczatkowe[p.klucz].trim() || '(puste)',
        na: wartosci[p.klucz].trim() || '(puste)',
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
          {POLA.map((p) => (
            <Pole
              key={p.klucz}
              etykieta={p.etykieta}
              wymagane={'wymagane' in p ? p.wymagane : undefined}
              value={wartosci[p.klucz]}
              onChangeText={(t) => setWartosci((w) => ({ ...w, [p.klucz]: t }))}
              keyboardType={'klawiatura' in p ? p.klawiatura : undefined}
              autoCapitalize={p.klucz === 'email' ? 'none' : 'sentences'}
              multiline={'wiele' in p ? p.wiele : undefined}
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
