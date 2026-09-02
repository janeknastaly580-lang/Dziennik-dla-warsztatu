/**
 * Formularz nowej wizyty / usterki.
 *
 * Otwierany DUZYM przyciskiem "DODAJ" z gory profilu klienta, wiec klient
 * jest juz znany. Do wypelnienia sa trzy okienka:
 *
 *   1. AUTO   - swobodny tekst. Nic nie jest sprawdzane: moze byc marka,
 *               model i numer rejestracyjny, moze byc "tansze auto pana
 *               Adama", moze byc jeden znak albo kilka linijek.
 *   2. TYTUL  - krotka nazwa zgloszenia (jedyne pole wymagane).
 *   3. OPIS   - szczegoly usterki.
 *   4. TERMIN - dzien i godziny wybierane palcem na siatce kalendarza.
 *               WYMAGANY: zgloszenie bez terminu nie powstanie. Kalendarz
 *               warsztatu ma pokazywac wszystko, co jest do zrobienia,
 *               a wizyta bez godzin nie trafilaby na zadna siatke.
 *
 * Statusu tu nie ma - kazde nowe zgloszenie startuje jako "nienaprawione".
 *
 * B3 - jesli to samo auto ma juz otwarta wizyte z ostatnich 48 godzin,
 *      formularz o tym mowi ZANIM powstanie drugie zgloszenie tej samej
 *      usterki. Offline nic tego nie wykryje za nas.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import EkranFormularza from '../../komponenty/EkranFormularza';
import {
  KomunikatFormularza, Pole, Przycisk, Sekcja, WyborOpcji,
} from '../../komponenty/Formularz';
import WierszTerminu, { KalendarzTerminu } from '../../komponenty/WyborTerminu';
import { otwartaWizytaTegoAuta, utworzWizyte } from '../../dane/repozytorium';
import { odswiezLicznikiKolejki } from '../../dane/synchronizacja';
import { formatujDate } from '../../format';
import { type Termin, domyslnyTermin } from '../../termin';
import { Kolory, Odstepy, PRIORYTETY, Zaokraglenia } from '../../motyw';
import { s } from '../../uklad';
import type { Priorytet, Wizyta } from '../../typy';

export default function EkranNowaWizyta() {
  const router = useRouter();
  const parametry = useLocalSearchParams<{ klientId: string }>();
  const idKlienta = String(parametry.klientId ?? '');

  const [auto, setAuto] = useState('');
  const [tytul, setTytul] = useState('');
  const [opis, setOpis] = useState('');
  const [priorytet, setPriorytet] = useState<Priorytet>('normalny');
  /* null, dopoki mechanik nie wskaze terminu na siatce - patrz `zapisz`. */
  const [termin, setTermin] = useState<Termin | null>(null);
  const [kalendarz, setKalendarz] = useState(false);

  const [podobna, setPodobna] = useState<Wizyta | null>(null);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);

  // B3: ostrzezenie o otwartej wizycie tego samego auta - na zywo.
  useEffect(() => {
    let aktywny = true;
    otwartaWizytaTegoAuta(auto).then((w) => { if (aktywny) setPodobna(w); });
    return () => { aktywny = false; };
  }, [auto]);

  const zapisz = useCallback(async () => {
    if (!idKlienta) {
      setBlad('Brak informacji, do ktorego klienta dodac zgloszenie.');
      return;
    }
    if (!tytul.trim()) {
      setBlad('Wpisz krotki tytul wizyty, np. "Stukanie w zawieszeniu".');
      return;
    }
    if (!termin) {
      setBlad('Wybierz termin wizyty - dotknij pola TERMIN i zaznacz godziny w kalendarzu.');
      return;
    }

    setZapisywanie(true);
    setBlad(null);
    try {
      await utworzWizyte({ klient_id: idKlienta, auto, tytul, opis, priorytet, termin });
      await odswiezLicznikiKolejki();
      if (router.canGoBack()) router.back();
      else router.replace(`/klient/${idKlienta}`);
    } catch (err) {
      setBlad(err instanceof Error ? err.message : 'Nie udalo sie zapisac zgloszenia.');
      setZapisywanie(false);
    }
  }, [idKlienta, auto, tytul, opis, priorytet, termin, router]);

  return (
    <>
      <EkranFormularza>
        <KomunikatFormularza tresc={blad} />

        {podobna ? (
          <Pressable
            onPress={() => router.replace(`/wizyta/${podobna.id}`)}
            style={style.ostrzezenie}
          >
            <Text style={style.ostrzezenieTytul}>To auto ma juz otwarta wizyte</Text>
            <Text style={style.ostrzezenieTekst}>
              {'"'}{podobna.tytul}{'"'} · {podobna.klient_nazwa ?? 'inny klient'} ·{' '}
              {formatujDate(podobna.data_wizyty)}
            </Text>
            <Text style={style.ostrzezenieTekst}>
              Dotknij, zeby ja otworzyc, zamiast zakladac drugie zgloszenie tej samej usterki.
            </Text>
          </Pressable>
        ) : null}

        <Sekcja tytul="AUTO">
          <Pole
            etykieta="Jakie to auto / wazna uwaga"
            value={auto}
            onChangeText={setAuto}
            placeholder={'np. Volkswagen Passat B8, KR 12345\nalbo po prostu: tansze auto pana Adama'}
            multiline
            style={style.poleAuta}
          />
          <Text style={style.podpowiedz}>Pole opisowe - wpisz co chcesz</Text>
        </Sekcja>

        <Sekcja tytul="ZGLOSZENIE">
          <Pole
            etykieta="Tytul wizyty"
            wymagane
            value={tytul}
            onChangeText={setTytul}
            placeholder="np. Stukanie w przednim zawieszeniu"
            autoFocus
          />
          <Pole
            etykieta="Opis"
            value={opis}
            onChangeText={setOpis}
            placeholder="Objawy, ustalenia z klientem, zakres naprawy..."
            multiline
          />
          <WyborOpcji
            etykieta="Priorytet"
            opcje={PRIORYTETY}
            wybrana={priorytet}
            onWybor={setPriorytet}
          />
        </Sekcja>

        <Sekcja tytul="TERMIN">
          <WierszTerminu wartosc={termin} onNacisnij={() => setKalendarz(true)} />
        </Sekcja>

        <View style={style.informacja}>
          <Text style={style.informacjaTekst}>
            Zgloszenie zostanie zapisane jako nienaprawione; status zmienia sie pozniej.
            Zapis dziala takze bez zasiegu - numer zlecenia dostaniesz od razu,
            a numer oficjalny nada serwer przy synchronizacji.
          </Text>
        </View>

        <View style={style.przyciski}>
          <Przycisk tytul="Zapisz zgloszenie" onPress={zapisz} zajety={zapisywanie} />
          <Przycisk
            tytul="Anuluj"
            wariant="drugi"
            onPress={() => router.back()}
            wylaczony={zapisywanie}
          />
        </View>
      </EkranFormularza>

      {/* Kalendarz stoi OBOK formularza, a nie w nim - inaczej nakladka
          przykrylaby tylko swoja sekcje zamiast calego ekranu. */}
      {kalendarz ? (
        <KalendarzTerminu
          wartosc={termin ?? domyslnyTermin()}
          onGotowe={(t) => { setTermin(t); setKalendarz(false); }}
          onAnuluj={() => setKalendarz(false)}
        />
      ) : null}
    </>
  );
}

const style = StyleSheet.create({
  poleAuta: { minHeight: s(76) },
  podpowiedz: {
    fontSize: s(12), color: Kolory.tekstSlaby, lineHeight: s(17), marginTop: -Odstepy.xs,
  },
  informacja: {
    backgroundColor: Kolory.akcentTlo,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  informacjaTekst: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstDrugi },
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
  ostrzezenieTekst: {
    fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstDrugi, marginTop: Odstepy.xs,
  },
});
