/**
 * Ekran parowania - pierwsze wejscie mechanika do aplikacji.
 *
 * Mechanik nie zna i nie wpisuje zadnego hasla do systemu. Podaje TYLKO
 * swoje imie i nazwisko i prosi o dostep. Na liscie administratora pojawia
 * sie gotowy wiersz - imie, nazwisko i kod tego telefonu - a administrator
 * klika "Zatwierdz". Nie wpisuje ani jednego znaku i nie musi wiedziec,
 * jak pisze sie czyjes nazwisko. Konto zaklada sie samo.
 *
 * Telefon odbiera dostep w ciagu kilku sekund i dopiero wtedy prosi
 * o ustawienie WLASNEGO hasla do blokady aplikacji.
 *
 * Ani kod, ani imie nie sa sekretem - same z siebie nic nie daja. Dostep
 * przyznaje administrator, a token odbiera wylacznie ten telefon, ktory ma
 * sekret zapisany w Keychain / Keystore.
 *
 * D2 - To jedyny moment, w ktorym internet jest konieczny. Wdrazaj
 *      mechanikow przy dzialajacym laczu.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as Device from 'expo-device';

import { Pole, Przycisk } from './Formularz';
import { aktywujZaproszenie, sprawdzZgode, zglosUrzadzenie, BladSieci } from '../dane/chmura';
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
  const [kodZaproszenia, setKodZaproszenia] = useState('');
  const [pokazZaproszenie, setPokazZaproszenie] = useState(false);
  const [imie, setImie] = useState('');
  const zywy = useRef(true);

  useEffect(() => () => { zywy.current = false; }, []);

  /* --------------------- odczyt zgloszenia z pamieci -------------------- */
  useEffect(() => {
    pobierzZgloszenie().then((z) => {
      if (!zywy.current) return;
      setZgloszenie(z);
      if (z?.imie) setImie(z.imie);
    });
  }, []);

  /* ------------------------------ zgloszenie ---------------------------- */
  const poprosOKod = useCallback(async () => {
    const czysteImie = imie.trim().replace(/\s+/g, ' ');
    if (czysteImie.length < 3) {
      setBlad('Wpisz swoje imie i nazwisko - pod nim administrator zobaczy Twoja prosbe.');
      return;
    }

    setZajety(true);
    setBlad(null);
    try {
      const nazwa = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ')
        || `telefon ${Platform.OS}`;
      const nowe = await zglosUrzadzenie({
        platforma: Platform.OS, nazwa_urzadzenia: nazwa, imie: czysteImie,
      });
      // Imie trzymamy takze u siebie - zeby po ponownym otwarciu aplikacji
      // bylo widac, o kogo prosbe wyslano.
      const zImieniem = { ...nowe, imie: czysteImie };
      await zapiszZgloszenie(zImieniem);
      if (zywy.current) setZgloszenie(zImieniem);
    } catch (err) {
      setBlad(err instanceof BladSieci
        ? 'Brak polaczenia z internetem. Pierwsze uruchomienie aplikacji wymaga sieci.'
        : 'Nie udalo sie poprosic o dostep. Sprobuj ponownie za chwile.');
    } finally {
      if (zywy.current) setZajety(false);
    }
  }, [imie]);

  /** Powrot do formularza: mechanik chce poprawic literowke w nazwisku. */
  const zacznijOdNowa = useCallback(() => {
    setZgloszenie(null);
    setBlad(null);
  }, []);

  /* ------------------------ kod zaproszenia ----------------------------- */
  /* Pierwszy telefon w warsztacie nie ma kogo poprosic o zgode - dostaje
     kod zaproszenia od dostawcy uslugi. Zaklada nim warsztat i wlasne konto
     administratora, a potem sam zatwierdza pozostalych mechanikow. */
  const uzyjZaproszenia = useCallback(async () => {
    let biezace = zgloszenie;
    setZajety(true);
    setBlad(null);
    try {
      if (!biezace) {
        const nazwa = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ')
          || `telefon ${Platform.OS}`;
        biezace = await zglosUrzadzenie({
          platforma: Platform.OS,
          nazwa_urzadzenia: nazwa,
          // Przy kodzie zaproszenia imie i tak bierze sie z samego kodu.
          imie: imie.trim(),
        });
        await zapiszZgloszenie(biezace);
        if (zywy.current) setZgloszenie(biezace);
      }

      const wynik = await aktywujZaproszenie(
        biezace.id, biezace.sekret, kodZaproszenia.trim().toUpperCase(),
      );
      if (!wynik.ok) {
        setBlad(wynik.blad ?? 'Nie udalo sie uzyc tego kodu.');
        return;
      }
      // Dostep jest juz przyznany - petla odpytywania odbierze token
      // przy najblizszym przebiegu, tak samo jak przy zgodzie administratora.
      setKodZaproszenia('');
      setPokazZaproszenie(false);
    } catch (err) {
      setBlad(err instanceof BladSieci
        ? 'Brak polaczenia z internetem. Aktywacja kodu wymaga sieci.'
        : 'Nie udalo sie uzyc tego kodu. Sprobuj ponownie.');
    } finally {
      if (zywy.current) setZajety(false);
    }
  }, [zgloszenie, kodZaproszenia, imie]);

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
            Brakuje adresu serwera albo klucza publicznego. Normalnie sa wpisane na
            stale w frontend/app.config.js (stale DOMYSLNY_ADRES i DOMYSLNY_KLUCZ_*)
            i nikt nie musi ich nigdzie wklejac. Jesli widzisz ten ekran, ktos je
            nadpisal pustymi zmiennymi EXPO_PUBLIC_SUPABASE_* w frontend/.env.
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
          Nie ma tu zadnego hasla do wpisania. Podaj swoje imie i nazwisko
          i popros o dostep - administrator warsztatu zatwierdzi Twoj telefon
          jednym klikniciem. Potem ustawisz wlasne haslo.
        </Text>

        {zgloszenie ? (
          <>
            {zgloszenie.imie ? (
              <View style={style.podpis}>
                <Text style={style.podpisEtykieta}>PROSBA WYSLANA JAKO</Text>
                <Text style={style.podpisImie}>{zgloszenie.imie}</Text>
              </View>
            ) : null}

            <View style={style.oczekiwanie}>
              {odpytywanie ? <ActivityIndicator color={Kolory.akcent} /> : null}
              <Text style={style.oczekiwanieTekst}>
                Czekam na zgode administratora...
              </Text>
            </View>

            <Text style={[style.tresc, style.drobne]}>
              Administrator widzi juz Twoje imie i nazwisko na swojej liscie -
              nie musisz mu niczego dyktowac. Ekran mozna zamknac; po ponownym
              otwarciu aplikacja wroci tutaj. Prosba jest wazna 24 godziny.
            </Text>

            {/* Kod schodzi na drugi plan: przydaje sie tylko wtedy, gdy
                administrator ma przed soba kilka podobnych zgloszen. */}
            <Text style={[style.tresc, style.drobne, style.bezMarginesu]}>
              Numer tej prosby: <Text style={style.kodWTekscie} selectable>{zgloszenie.kod}</Text>
            </Text>

            <Pressable onPress={zacznijOdNowa} hitSlop={8}>
              <Text style={style.link}>Poprawic imie i nazwisko?</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pole
              etykieta="Imie i nazwisko"
              wymagane
              value={imie}
              onChangeText={setImie}
              placeholder="np. Jan Kowalski"
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={120}
              onSubmitEditing={poprosOKod}
              returnKeyType="go"
            />
            <Text style={[style.tresc, style.drobne]}>
              Pod tym imieniem administrator zobaczy Twoja prosbe i pod nim
              powstanie Twoje konto. Do pierwszego uruchomienia potrzebny jest
              internet - pozniej aplikacja dziala takze bez zasiegu.
            </Text>
            <Przycisk tytul="Popros o dostep" onPress={poprosOKod} zajety={zajety} />
          </>
        )}

        {blad ? <Text style={style.blad}>{blad}</Text> : null}
      </View>

      {/* Druga droga wejscia: pierwszy telefon w warsztacie. Nie ma jeszcze
          administratora, ktory by go zatwierdzil, wiec zaklada warsztat
          kodem zaproszenia otrzymanym od dostawcy uslugi. */}
      <View style={style.karta}>
        {pokazZaproszenie ? (
          <>
            <Text style={style.tytulMniejszy}>Kod zaproszenia</Text>
            <Text style={[style.tresc, style.drobne]}>
              Uruchamiasz warsztat po raz pierwszy? Wpisz kod otrzymany przy
              zakupie usugi - zalozy on warsztat i Twoje konto administratora.
            </Text>
            <Pole
              etykieta="Kod"
              value={kodZaproszenia}
              onChangeText={(t) => setKodZaproszenia(t.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={24}
            />
            <Przycisk tytul="Uzyj kodu" onPress={uzyjZaproszenia} zajety={zajety} />
            <Przycisk
              tytul="Wroc"
              wariant="drugi"
              onPress={() => { setPokazZaproszenie(false); setBlad(null); }}
            />
          </>
        ) : (
          <Pressable onPress={() => setPokazZaproszenie(true)} hitSlop={8}>
            <Text style={style.link}>Mam kod zaproszenia</Text>
            <Text style={[style.tresc, style.drobne, style.bezMarginesu]}>
              Dla pierwszej osoby w warsztacie, ktora zaklada konto administratora.
            </Text>
          </Pressable>
        )}
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
  tytulMniejszy: { fontSize: s(16), fontWeight: '800', color: Kolory.tekst, marginBottom: Odstepy.s },
  bezMarginesu: { marginBottom: 0 },
  tytulOdciecia: { fontSize: s(19), fontWeight: '800', color: Kolory.pilne, marginBottom: Odstepy.s },
  tresc: { fontSize: s(14.5), lineHeight: s(21), color: Kolory.tekstDrugi, marginBottom: Odstepy.m },
  drobne: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstSlaby },
  podpis: {
    backgroundColor: Kolory.akcentTlo,
    borderWidth: 1,
    borderColor: Kolory.akcent,
    borderRadius: Zaokraglenia.l,
    paddingVertical: Odstepy.m,
    paddingHorizontal: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  podpisEtykieta: {
    fontSize: s(10.5), fontWeight: '800', letterSpacing: 0.8,
    color: Kolory.akcentCiemny, marginBottom: 2,
  },
  podpisImie: { fontSize: s(19), fontWeight: '800', color: Kolory.akcentCiemny },
  kodWTekscie: {
    fontWeight: '800',
    letterSpacing: s(1),
    color: Kolory.tekstDrugi,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  oczekiwanie: { flexDirection: 'row', alignItems: 'center', gap: Odstepy.s, marginBottom: Odstepy.m },
  oczekiwanieTekst: { fontSize: s(13.5), color: Kolory.tekstDrugi, fontWeight: '600' },
  link: { fontSize: s(14), fontWeight: '700', color: Kolory.akcent, paddingVertical: Odstepy.s },
  blad: { fontSize: s(13.5), color: Kolory.blad, marginTop: Odstepy.s, lineHeight: s(19) },
});
