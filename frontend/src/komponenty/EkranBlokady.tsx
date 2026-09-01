/**
 * Blokada aplikacji: ustawienie hasla i codzienne odblokowywanie.
 *
 * A5 - Wlasna blokada, nie tylko systemowa. Komputer lezacy otwarty na
 *      warsztacie nie pokazuje danych klientow po 5 minutach bezczynnosci
 *      ani po przelaczeniu aplikacji w tlo.
 * D1 - Ten ekran NIE ROZMAWIA Z SIECIA. Odblokowanie dziala tak samo
 *      w kanale bez zasiegu jak przy Wi-Fi.
 * A4 - Po dziesieciu nieudanych probach aplikacja kasuje lokalna baze.
 *      Znaleziony komputer nie jest darmowa kartoteka klientow.
 *
 * Haslo moze byc dowolne - to blokada aplikacji, a nie haslo do bazy.
 * Dostepu do danych w chmurze pilnuje token urzadzenia, ktory administrator
 * moze uniewaznic jednym przyciskiem.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { Pole, Przycisk } from './Formularz';
import {
  pozostaleProby, sprawdzHaslo, ustawHaslo,
} from '../dane/sesja';
import { pobierzToken } from '../dane/sesja';
import { zglosUstawienieHasla } from '../dane/chmura';
import { potwierdzResetHasla } from '../dane/synchronizacja';
import { zapiszWDzienniku } from '../dane/repozytorium';
import { useAplikacja } from '../dane/kontekst';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import { s, wys } from '../uklad';

export function EkranUstawieniaHasla() {
  const { odblokowano, mechanik, sync } = useAplikacja();
  const [haslo, setHaslo] = useState('');
  const [powtorzenie, setPowtorzenie] = useState('');
  const [zajety, setZajety] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);

  const zapisz = useCallback(async () => {
    if (!haslo.trim()) {
      setBlad('Wpisz haslo. Moze byc dowolne - to blokada aplikacji na tym komputerze.');
      return;
    }
    if (haslo !== powtorzenie) {
      setBlad('Oba pola musza byc takie same.');
      return;
    }
    setZajety(true);
    setBlad(null);
    try {
      await ustawHaslo(haslo);
      potwierdzResetHasla();
      // Meldunek do serwera jest mile widziany, ale nie jest warunkiem -
      // brak sieci nie moze zablokowac wejscia do aplikacji (D1).
      const token = await pobierzToken();
      if (token) await zglosUstawienieHasla(token).catch(() => undefined);
      odblokowano();
    } catch (err) {
      setBlad(err instanceof Error ? err.message : 'Nie udalo sie zapisac hasla.');
    } finally {
      setZajety(false);
    }
  }, [haslo, powtorzenie, odblokowano]);

  return (
    <KeyboardAvoidingView
      style={style.ekran}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={style.tresc} keyboardShouldPersistTaps="handled">
        <View style={style.karta}>
          <Text style={style.tytul}>
            {sync.resetHasla ? 'Ustaw nowe haslo' : 'Ustaw swoje haslo'}
          </Text>
          <Text style={style.opis}>
            {sync.resetHasla
              ? 'Administrator poprosil o zmiane hasla do tej aplikacji.'
              : `Masz juz dostep${mechanik ? `, ${mechanik}` : ''}. Wymysl haslo, ktorym `
                + 'bedziesz otwierac aplikacje na tym komputerze.'}
          </Text>
          <Text style={style.podpowiedz}>
            Haslo moze byc dowolne - dziala tylko na tym komputerze i nie otwiera
            niczego w internecie. Jesli je zapomnisz, administrator jednym
            klikniciem pozwoli Ci ustawic nowe.
          </Text>

          <Pole
            etykieta="Haslo"
            value={haslo}
            onChangeText={setHaslo}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
          />
          <Pole
            etykieta="Powtorz haslo"
            value={powtorzenie}
            onChangeText={setPowtorzenie}
            secureTextEntry
            autoCapitalize="none"
          />

          {blad ? <Text style={style.blad}>{blad}</Text> : null}
          <Przycisk tytul="Zapisz haslo i wejdz" onPress={zapisz} zajety={zajety} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function EkranOdblokowania() {
  const { odblokowano, mechanik, warsztat } = useAplikacja();
  const [haslo, setHaslo] = useState('');
  const [zajety, setZajety] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [proby, setProby] = useState<number | null>(null);

  useEffect(() => {
    pozostaleProby().then(setProby);
  }, []);

  const wpuscDoSrodka = useCallback(async () => {
    setHaslo('');
    await zapiszWDzienniku('odblokowanie');
    odblokowano();
  }, [odblokowano]);

  const przezHaslo = useCallback(async () => {
    setZajety(true);
    setBlad(null);
    try {
      const wynik = await sprawdzHaslo(haslo);
      if (wynik.ok) {
        await wpuscDoSrodka();
        return;
      }
      if ('wyczyszczono' in wynik) {
        setBlad('Za duzo nieudanych prob. Dane warsztatu zostaly skasowane '
          + 'z tego komputera. Popros administratora o ponowne przyznanie dostepu.');
        setProby(0);
        return;
      }
      setProby(wynik.pozostalo);
      setBlad(`Nieprawidlowe haslo. Pozostalo prob: ${wynik.pozostalo}.`);
    } finally {
      setZajety(false);
    }
  }, [haslo, wpuscDoSrodka]);

  return (
    <KeyboardAvoidingView
      style={style.ekran}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={style.tresc} keyboardShouldPersistTaps="handled">
        <View style={style.karta}>
          <Text style={style.tytul}>Aplikacja zablokowana</Text>
          <Text style={style.opis}>
            {mechanik ? `${mechanik}` : 'Mechanik'}
            {warsztat ? ` · ${warsztat}` : ''}
          </Text>

          <Pole
            etykieta="Haslo"
            value={haslo}
            onChangeText={setHaslo}
            secureTextEntry
            autoCapitalize="none"
            autoFocus
            onSubmitEditing={przezHaslo}
            returnKeyType="go"
          />

          {blad ? <Text style={style.blad}>{blad}</Text> : null}
          {proby !== null && proby <= 3 && proby > 0 && !blad ? (
            <Text style={style.blad}>
              Uwaga: po {proby} kolejnych nieudanych probach aplikacja skasuje dane
              z tego komputera.
            </Text>
          ) : null}

          <Przycisk tytul="Odblokuj" onPress={przezHaslo} zajety={zajety} />

          <Text style={style.podpowiedz}>
            Nie pamietasz hasla? Popros administratora - w panelu jednym klikniciem
            pozwoli Ci ustawic nowe, bez utraty danych.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  tresc: { flexGrow: 1, justifyContent: 'center', padding: Odstepy.l, paddingBottom: wys(8, 32) },
  karta: {
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.xl,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    padding: Odstepy.xl,
    ...cien('lekki'),
  },
  tytul: { fontSize: s(21), fontWeight: '800', color: Kolory.tekst },
  opis: { fontSize: s(14), color: Kolory.tekstDrugi, marginTop: 2, marginBottom: Odstepy.l },
  podpowiedz: {
    fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstSlaby, marginTop: Odstepy.m,
  },
  blad: { fontSize: s(13.5), lineHeight: s(19), color: Kolory.blad, marginBottom: Odstepy.s },
});
