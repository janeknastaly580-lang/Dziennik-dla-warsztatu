/**
 * Formularz nowego klienta.
 *
 * B3 - zanim zalozymy kartoteke, sprawdzamy w lokalnej bazie, czy ktos juz nie
 *      ma tego numeru telefonu. Dwa komputery pracujace bez sieci moga zalozyc
 *      te sama kartoteke i NIC sie nie nadpisze - wiec system nie zglosi bledu.
 *      Dlatego ostrzezenie musi paść tutaj, zanim duplikat powstanie.
 *
 * Zapis konczy sie w lokalnej bazie. Wyslanie na serwer dzieje sie pozniej,
 * w tle - formularz nie czeka na siec (D1).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import EkranFormularza from '../../komponenty/EkranFormularza';
import { KomunikatFormularza, Pole, Przycisk, Sekcja } from '../../komponenty/Formularz';
import { klienciZTymSamymTelefonem, utworzKlienta } from '../../dane/repozytorium';
import { odswiezLicznikiKolejki } from '../../dane/synchronizacja';
import { POLA_KLIENTA, PUSTY_KLIENT, type WartosciKlienta } from '../../polaKlienta';
import { Kolory, Odstepy, Zaokraglenia } from '../../motyw';
import { s } from '../../uklad';
import type { KlientNaLiscie } from '../../typy';

export default function EkranNowyKlient() {
  const router = useRouter();

  const [wartosci, setWartosci] = useState<WartosciKlienta>(PUSTY_KLIENT);
  const [podobni, setPodobni] = useState<KlientNaLiscie[]>([]);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);

  // B3: ostrzezenie pojawia sie na zywo, w trakcie wpisywania numeru.
  useEffect(() => {
    let aktywny = true;
    klienciZTymSamymTelefonem(wartosci.telefon).then((lista) => {
      if (aktywny) setPodobni(lista);
    });
    return () => { aktywny = false; };
  }, [wartosci.telefon]);

  const zapisz = useCallback(async () => {
    if (!wartosci.nazwa.trim()) {
      setBlad('Podaj imie i nazwisko lub nazwe firmy.');
      return;
    }
    setZapisywanie(true);
    setBlad(null);
    try {
      const id = await utworzKlienta(wartosci);
      await odswiezLicznikiKolejki();
      router.replace(`/klient/${id}`);
    } catch (err) {
      setBlad(err instanceof Error ? err.message : 'Nie udalo sie zapisac klienta.');
      setZapisywanie(false);
    }
  }, [wartosci, router]);

  return (
    <EkranFormularza>
        <KomunikatFormularza tresc={blad} />

        {podobni.length ? (
          <View style={style.ostrzezenie}>
            <Text style={style.ostrzezenieTytul}>Ten numer juz jest w bazie</Text>
            {podobni.map((k) => (
              <Pressable key={k.id} onPress={() => router.replace(`/klient/${k.id}`)}>
                <Text style={style.ostrzezenieLink}>
                  {k.nazwa} · {k.liczba_wizyt} wizyt · dotknij, aby otworzyc
                </Text>
              </Pressable>
            ))}
            <Text style={style.ostrzezenieTekst}>
              Jesli to ten sam klient, otworz istniejaca kartoteke zamiast zakladac druga.
            </Text>
          </View>
        ) : null}

        <Sekcja tytul="DANE KLIENTA">
          {POLA_KLIENTA.map((pole, i) => (
            <Pole
              key={pole.klucz}
              etykieta={pole.etykieta}
              wymagane={'wymagane' in pole ? pole.wymagane : undefined}
              value={wartosci[pole.klucz]}
              onChangeText={(t) => setWartosci((w) => ({ ...w, [pole.klucz]: t }))}
              placeholder={'placeholder' in pole ? pole.placeholder : undefined}
              keyboardType={'klawiatura' in pole ? pole.klawiatura : undefined}
              autoCapitalize={'bezWielkichLiter' in pole ? 'none' : 'sentences'}
              multiline={'wiele' in pole ? pole.wiele : undefined}
              autoFocus={i === 0}
            />
          ))}
        </Sekcja>

        <Text style={style.podpowiedz}>
          Auto wpiszesz przy pierwszej wizycie - w profilu klienta duzym przyciskiem
          {' "DODAJ"'}. Zapis dziala takze bez zasiegu; dane pojda na serwer, gdy
          tylko wroci internet.
        </Text>

        <View style={style.przyciski}>
          <Przycisk tytul="Zapisz klienta" onPress={zapisz} zajety={zapisywanie} />
          <Przycisk
            tytul="Anuluj"
            wariant="drugi"
            onPress={() => router.back()}
            wylaczony={zapisywanie}
          />
        </View>
    </EkranFormularza>
  );
}

const style = StyleSheet.create({
  podpowiedz: {
    fontSize: s(12.5), color: Kolory.tekstSlaby, lineHeight: s(17), marginBottom: Odstepy.m,
  },
  przyciski: { gap: Odstepy.s, marginTop: Odstepy.xs },
  ostrzezenie: {
    backgroundColor: Kolory.wTrakcieTlo,
    borderWidth: 1,
    borderColor: Kolory.wTrakcieObramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  ostrzezenieTytul: { fontSize: s(13.5), fontWeight: '800', color: Kolory.wTrakcie },
  ostrzezenieLink: {
    fontSize: s(14), fontWeight: '700', color: Kolory.akcent, marginTop: Odstepy.xs,
  },
  ostrzezenieTekst: {
    fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstDrugi, marginTop: Odstepy.s,
  },
});
