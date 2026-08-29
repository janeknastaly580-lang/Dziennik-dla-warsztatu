/**
 * Ekran parowania - pierwsze wejscie mechanika do aplikacji.
 *
 * Mechanik nie zna i nie wpisuje zadnego hasla do systemu. Aplikacja pokazuje
 * osmioznakowy kod, mechanik podaje go administratorowi, a administrator
 * jednym klikniciem w panelu przydziela ten telefon konkretnemu czlowiekowi.
 * Telefon odbiera dostep w ciagu kilku sekund i dopiero wtedy prosi
 * o ustawienie WLASNEGO hasla do blokady aplikacji.
 *
 * Kod nie jest sekretem - sam z siebie nic nie daje. Dostep przyznaje
 * administrator, a token odbiera wylacznie ten telefon, ktory ma sekret
 * zapisany w Keychain / Keystore.
 *
 * D2 - To jedyny moment, w ktorym internet jest konieczny. Wdrazaj
 *      mechanikow przy dzialajacym laczu.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as Device from 'expo-device';

import { Przycisk } from './Formularz';
import { sprawdzZgode, zglosUrzadzenie, BladSieci } from '../dane/chmura';
import {
  pobierzZgloszenie, zapiszDostep, zapiszZgloszenie, ZgloszenieParowania,
} from '../dane/sesja';
import { potwierdzOdciecie } from '../dane/synchronizacja';
import { useAplikacja } from '../dane/kontekst';
import { czyChmuraSkonfigurowana } from '../dane/konfiguracja';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import { s, wys } from '../uklad';

const OKRES_ODPYTANIA_MS = 5000;

export default function EkranParowania() {
  const { odswiezFaze, sync } = useAplikacja();

  const [zgloszenie, setZgloszenie] = useState<ZgloszenieParowania | null>(null);
  const [zajety, setZajety] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [odpytywanie, setOdpytywanie] = useState(false);
  const zywy = useRef(true);

  useEffect(() => () => { zywy.current = false; }, []);

  /* --------------------- odczyt zgloszenia z pamieci -------------------- */
  useEffect(() => {
    pobierzZgloszenie().then((z) => { if (zywy.current) setZgloszenie(z); });
  }, []);

  /* ------------------------------ zgloszenie ---------------------------- */
  const poprosOKod = useCallback(async () => {
    setZajety(true);
    setBlad(null);
    try {
      const nazwa = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ')
        || `telefon ${Platform.OS}`;
      const nowe = await zglosUrzadzenie({ platforma: Platform.OS, nazwa_urzadzenia: nazwa });
      await zapiszZgloszenie(nowe);
      if (zywy.current) setZgloszenie(nowe);
    } catch (err) {
      setBlad(err instanceof BladSieci
        ? 'Brak polaczenia z internetem. Pierwsze uruchomienie aplikacji wymaga sieci.'
        : 'Nie udalo sie poprosic o dostep. Sprobuj ponownie za chwile.');
    } finally {
      if (zywy.current) setZajety(false);
    }
  }, []);

  /* -------------------- odpytywanie o zgode administratora -------------- */
  useEffect(() => {
    if (!zgloszenie) return undefined;
    let aktywne = true;

    const sprawdz = async () => {
      if (!aktywne) return;
      setOdpytywanie(true);
      try {
        const wynik = await sprawdzZgode(zgloszenie.id, zgloszenie.sekret);
        if (!aktywne) return;

        if (wynik.status === 'przyznany') {
          await zapiszDostep({
            token: wynik.token,
            urzadzenie_id: wynik.urzadzenie_id,
            mechanik: wynik.mechanik,
            warsztat: wynik.warsztat,
          });
          potwierdzOdciecie();
          await odswiezFaze();
          return;
        }
        if (wynik.status === 'wygasl') {
          setBlad('Kod stracil waznosc. Popros o nowy.');
          setZgloszenie(null);
        }
      } catch (err) {
        // Brak sieci przy odpytywaniu to nic zlego - probujemy dalej.
        if (!(err instanceof BladSieci)) {
          setBlad('Zgloszenie jest juz nieaktualne. Popros o nowy kod.');
          setZgloszenie(null);
        }
      } finally {
        if (aktywne) setOdpytywanie(false);
      }
    };

    sprawdz();
    const licznik = setInterval(sprawdz, OKRES_ODPYTANIA_MS);
    return () => { aktywne = false; clearInterval(licznik); };
  }, [zgloszenie, odswiezFaze]);

  /* -------------------------------- widok ------------------------------- */

  if (!czyChmuraSkonfigurowana()) {
    return (
      <View style={style.ekran}>
        <View style={style.karta}>
          <Text style={style.tytul}>Aplikacja nie jest skonfigurowana</Text>
          <Text style={style.tresc}>
            W pliku frontend/app.json brakuje adresu serwera albo klucza publicznego
            (sekcja "extra"). Uzupelnij je i zbuduj aplikacje ponownie.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={style.ekran}>
      {sync.odciecie ? (
        <View style={[style.karta, style.kartaOdciecia]}>
          <Text style={style.tytulOdciecia}>Dostep zostal odebrany</Text>
          <Text style={style.tresc}>
            {sync.odciecie.powod
              ?? 'Administrator zablokowal dostep tego telefonu do danych warsztatu.'}
          </Text>
          <Text style={[style.tresc, style.drobne]}>
            Dane warsztatu zostaly skasowane z tego telefonu. Zeby wrocic do pracy,
            popros administratora o ponowne przyznanie dostepu.
          </Text>
        </View>
      ) : null}

      <View style={style.karta}>
        <Text style={style.tytul}>Dostep do aplikacji</Text>
        <Text style={style.tresc}>
          Nie ma tu zadnego hasla do wpisania. Dostep przyznaje administrator
          warsztatu - zdalnie, jeden raz. Potem ustawisz wlasne haslo.
        </Text>

        {zgloszenie ? (
          <>
            <Text style={style.etykieta}>PODAJ TEN KOD ADMINISTRATOROWI</Text>
            <View style={style.kodRamka}>
              <Text style={style.kod} selectable>{zgloszenie.kod}</Text>
            </View>

            <View style={style.oczekiwanie}>
              {odpytywanie ? <ActivityIndicator color={Kolory.akcent} /> : null}
              <Text style={style.oczekiwanieTekst}>
                Czekam na zgode administratora...
              </Text>
            </View>

            <Text style={[style.tresc, style.drobne]}>
              Kod jest wazny 24 godziny. Ekran mozna zamknac - po ponownym otwarciu
              aplikacja wroci tutaj z tym samym kodem.
            </Text>

            <Pressable onPress={poprosOKod} hitSlop={8}>
              <Text style={style.link}>Popros o nowy kod</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[style.tresc, style.drobne]}>
              Do pierwszego uruchomienia potrzebny jest internet. Pozniej aplikacja
              dziala takze bez zasiegu.
            </Text>
            <Przycisk tytul="Popros o dostep" onPress={poprosOKod} zajety={zajety} />
          </>
        )}

        {blad ? <Text style={style.blad}>{blad}</Text> : null}
      </View>
    </ScrollView>
  );
}

const style = StyleSheet.create({
  ekran: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Odstepy.l,
    paddingBottom: wys(8, 32),
    backgroundColor: Kolory.tlo,
  },
  karta: {
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.xl,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    padding: Odstepy.xl,
    marginBottom: Odstepy.m,
    ...cien('lekki'),
  },
  kartaOdciecia: { backgroundColor: Kolory.pilneTlo, borderColor: Kolory.pilneObramowanie },
  tytul: { fontSize: s(21), fontWeight: '800', color: Kolory.tekst, marginBottom: Odstepy.s },
  tytulOdciecia: { fontSize: s(19), fontWeight: '800', color: Kolory.pilne, marginBottom: Odstepy.s },
  tresc: { fontSize: s(14.5), lineHeight: s(21), color: Kolory.tekstDrugi, marginBottom: Odstepy.m },
  drobne: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstSlaby },
  etykieta: {
    fontSize: s(11), fontWeight: '800', letterSpacing: 0.8,
    color: Kolory.tekstSlaby, marginBottom: Odstepy.s,
  },
  kodRamka: {
    backgroundColor: Kolory.akcentTlo,
    borderWidth: 2,
    borderColor: Kolory.akcent,
    borderRadius: Zaokraglenia.l,
    paddingVertical: Odstepy.l,
    alignItems: 'center',
    marginBottom: Odstepy.m,
  },
  kod: {
    fontSize: s(32),
    fontWeight: '900',
    letterSpacing: s(6),
    color: Kolory.akcentCiemny,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  oczekiwanie: { flexDirection: 'row', alignItems: 'center', gap: Odstepy.s, marginBottom: Odstepy.m },
  oczekiwanieTekst: { fontSize: s(13.5), color: Kolory.tekstDrugi, fontWeight: '600' },
  link: { fontSize: s(14), fontWeight: '700', color: Kolory.akcent, paddingVertical: Odstepy.s },
  blad: { fontSize: s(13.5), color: Kolory.blad, marginTop: Odstepy.s, lineHeight: s(19) },
});
