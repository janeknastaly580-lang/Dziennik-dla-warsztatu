/**
 * Ekran "Aplikacja i synchronizacja".
 *
 * Nie ma tu juz adresu serwera do wpisywania - aplikacja laczy sie z chmura
 * warsztatu, a dostep przyznaje administrator. Zamiast tego mechanik widzi to,
 * co naprawde musi wiedziec:
 *
 *  D4  kiedy ostatnio udalo sie polaczyc z serwerem (wiek danych),
 *  D5  ile zmian czeka jeszcze na wyslanie i jak dlugo czeka najstarsza,
 *  A4  po ilu dniach bez polaczenia telefon sam skasuje swoje dane,
 *  A10 informacje, ze wgladu w kartoteki sa zapisywane.
 *
 * Nie ma i nie bedzie funkcji "eksportuj wszystko do pliku" (A10) - nic tak
 * nie ulatwia wyniesienia calej bazy klientow jak jeden przycisk.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Przycisk, Sekcja } from '../komponenty/Formularz';
import Potwierdzenie from '../komponenty/Potwierdzenie';
import { pobierzMeta } from '../dane/baza';
import { liczbaWKolejce } from '../dane/kolejka';
import { pobierzIdUrzadzenia } from '../dane/sesja';
import { useAplikacja } from '../dane/kontekst';
import { WERSJA_APLIKACJI, WERSJA_SCHEMATU } from '../dane/konfiguracja';
import { Kolory, Odstepy, Zaokraglenia } from '../motyw';
import { s, wys } from '../uklad';

function czasLokalny(iso: string | null): string {
  if (!iso) return 'jeszcze nigdy';
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

export default function EkranUstawien() {
  const router = useRouter();
  const { sync, mechanik, warsztat, synchronizuj, wyloguj, zablokuj } = useAplikacja();

  const [urzadzenie, setUrzadzenie] = useState<string | null>(null);
  const [okno, setOkno] = useState<string | null>(null);
  const [wygasniecie, setWygasniecie] = useState<string | null>(null);
  const [wKolejce, setWKolejce] = useState(0);
  const [pytanieOWylogowanie, setPytanieOWylogowanie] = useState(false);

  useEffect(() => {
    pobierzIdUrzadzenia().then(setUrzadzenie);
    pobierzMeta('okno_dni').then(setOkno);
    pobierzMeta('wygasniecie_offline_dni').then(setWygasniecie);
    liczbaWKolejce().then(setWKolejce);
  }, [sync]);

  const wymusSynchronizacje = useCallback(async () => {
    await synchronizuj({ wymuszona: true });
    setWKolejce(await liczbaWKolejce());
  }, [synchronizuj]);

  const potwierdzWylogowanie = useCallback(async () => {
    setPytanieOWylogowanie(false);
    await wyloguj();
    router.replace('/');
  }, [wyloguj, router]);

  return (
    <ScrollView style={style.ekran} contentContainerStyle={style.tresc}>
      <Sekcja tytul="SYNCHRONIZACJA">
        <Wiersz etykieta="Ostatnie polaczenie" wartosc={czasLokalny(sync.ostatniaUdana)} />
        <Wiersz
          etykieta="Czeka na wyslanie"
          wartosc={wKolejce === 0 ? 'nic - wszystko wyslane' : `${wKolejce} zmian`}
          alarm={wKolejce > 0}
        />
        {sync.najstarszaCzeka ? (
          <Wiersz
            etykieta="Najstarsza zmiana z"
            wartosc={czasLokalny(sync.najstarszaCzeka)}
            alarm={Date.now() - new Date(sync.najstarszaCzeka).getTime() > 24 * 3600 * 1000}
          />
        ) : null}
        {sync.blad ? <Wiersz etykieta="Ostatni komunikat" wartosc={sync.blad} alarm /> : null}

        <Przycisk
          tytul={sync.trwa ? 'Synchronizacja...' : 'Synchronizuj teraz'}
          onPress={wymusSynchronizacje}
          zajety={sync.trwa}
        />
        <Text style={style.podpowiedz}>
          Wszystko, co wpiszesz, zapisuje sie najpierw na telefonie i nie ginie przy
          braku zasiegu. Na serwer trafia w tle, gdy tylko pojawi sie internet.
        </Text>
      </Sekcja>

      <Sekcja tytul="TO URZADZENIE">
        <Wiersz etykieta="Mechanik" wartosc={mechanik ?? '-'} />
        <Wiersz etykieta="Warsztat" wartosc={warsztat ?? '-'} />
        <Wiersz etykieta="Wersja aplikacji" wartosc={WERSJA_APLIKACJI} />
        <Wiersz etykieta="Wersja danych" wartosc={String(WERSJA_SCHEMATU)} />
        <Wiersz etykieta="Historia na telefonie" wartosc={`${okno ?? '90'} dni + wszystko otwarte`} />
        <Wiersz
          etykieta="Numer urzadzenia"
          wartosc={urzadzenie ? `${urzadzenie.slice(0, 8)}...` : '-'}
        />
        <Text style={style.podpowiedz}>
          Podaj numer urzadzenia administratorowi, jesli prosi o identyfikacje telefonu.
        </Text>
      </Sekcja>

      <Sekcja tytul="BEZPIECZENSTWO">
        <View style={style.informacja}>
          <Text style={style.informacjaTekst}>
            Aplikacja blokuje sie sama po 5 minutach bezczynnosci i za kazdym razem,
            gdy przelaczysz sie na inna aplikacje.
          </Text>
          <Text style={style.informacjaTekst}>
            Jesli telefon nie polaczy sie z serwerem przez {wygasniecie ?? '14'} dni,
            skasuje dane warsztatu ze swojej pamieci. To zabezpieczenie na wypadek
            zgubienia albo kradziezy - zgubiony telefon czysci sie sam.
          </Text>
          <Text style={style.informacjaTekst}>
            Otwarcia kartotek klientow sa zapisywane w dzienniku dostepu warsztatu.
          </Text>
          <Text style={style.informacjaTekst}>
            Aplikacja nie robi ani nie przechowuje zdjec. Opis usterki wpisuj tekstem.
          </Text>
        </View>

        <Przycisk tytul="Zablokuj aplikacje teraz" wariant="drugi" onPress={zablokuj} />
        <Przycisk
          tytul="Wyloguj i wyczysc ten telefon"
          wariant="niebezpieczny"
          onPress={() => setPytanieOWylogowanie(true)}
        />
        <Text style={style.podpowiedz}>
          Wylogowanie kasuje z telefonu wszystkie dane warsztatu. Zrob to, zanim
          oddasz telefon komukolwiek innemu.
        </Text>
      </Sekcja>

      {pytanieOWylogowanie ? (
        <Potwierdzenie
          widoczne
          tytul="Wylogowac i wyczyscic dane?"
          tresc={wKolejce > 0
            ? `UWAGA: ${wKolejce} zmian nie zostalo jeszcze wyslanych na serwer i przepadnie. `
              + 'Najpierw polacz sie z internetem i poczekaj, az licznik pokaze zero.'
            : 'Wszystkie dane warsztatu znikna z tego telefonu. Zeby wrocic do pracy, '
              + 'administrator bedzie musial przyznac dostep od nowa.'}
          tekstAkcji="Wyloguj i wyczysc"
          tekstAnuluj="Anuluj"
          wariant="niebezpieczny"
          onAkcja={potwierdzWylogowanie}
          onAnuluj={() => setPytanieOWylogowanie(false)}
        />
      ) : null}
    </ScrollView>
  );
}

function Wiersz({ etykieta, wartosc, alarm }: {
  etykieta: string; wartosc: string; alarm?: boolean;
}) {
  return (
    <View style={style.wiersz}>
      <Text style={style.wierszEtykieta}>{etykieta}</Text>
      <Text style={[style.wierszWartosc, alarm && style.wierszAlarm]} numberOfLines={3}>
        {wartosc}
      </Text>
    </View>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  tresc: { padding: Odstepy.l, paddingBottom: wys(8, 32) },
  wiersz: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Odstepy.m,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Kolory.obramowanie,
  },
  wierszEtykieta: { fontSize: s(13), color: Kolory.tekstSlaby, flexShrink: 0 },
  wierszWartosc: {
    fontSize: s(14), fontWeight: '600', color: Kolory.tekst, flex: 1, textAlign: 'right',
  },
  wierszAlarm: { color: Kolory.wTrakcie },
  podpowiedz: {
    fontSize: s(12.5),
    lineHeight: s(18),
    color: Kolory.tekstSlaby,
    marginTop: Odstepy.s,
    fontFamily: Platform.select({ default: undefined }),
  },
  informacja: {
    backgroundColor: Kolory.akcentTlo,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
    gap: Odstepy.s,
  },
  informacjaTekst: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstDrugi },
});
