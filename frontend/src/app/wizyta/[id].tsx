/**
 * Szczegoly wizyty / usterki.
 *
 * Ekran pozwala jednym dotknieciem zmienic status (to steruje wielkoscia
 * kafelka w historii) i usunac zgloszenie.
 *
 * NIE MA TU ZDJEC. System swiadomie nie przechowuje fotografii - ani na
 * telefonie, ani w chmurze. Znika przez to caly lancuch ryzyk: metadane GPS
 * i wizerunki osob w tle (A7), publiczny magazyn plikow i wyciekajace adresy
 * (A8), rozjazd miedzy baza a magazynem (B7), zapchana pamiec telefonu (D6)
 * i zalanie lacza po powrocie sieci (D7). Opis tekstowy wystarcza.
 *
 * B1 - zmiana statusu wysyla na serwer WYLACZNIE kolumne `status`.
 *      Kolega, ktory w tym czasie poprawil opis, nie straci swojej zmiany.
 * A10 - otwarcie zgloszenia ladzie w dzienniku dostepu.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Przycisk } from '../../komponenty/Formularz';
import Potwierdzenie from '../../komponenty/Potwierdzenie';
import { KomunikatBledu, Ladowanie } from '../../komponenty/Stany';
import {
  pobierzWizyte, usunWizyte, zapiszWDzienniku, zmienStatusWizyty,
} from '../../dane/repozytorium';
import { odswiezLicznikiKolejki } from '../../dane/synchronizacja';
import { useAplikacja } from '../../dane/kontekst';
import {
  formatujDate, formatujKwote, formatujPrzebieg, opisAuta,
} from '../../format';
import {
  ETYKIETA_PRIORYTETU, Kolory, Odstepy, Zaokraglenia, cien, opisStatusu,
} from '../../motyw';
import { CEL_DOTYKU, s, wys } from '../../uklad';
import type { Status, Wizyta } from '../../typy';

const STATUSY: { wartosc: Status; etykieta: string }[] = [
  { wartosc: 'nienaprawione', etykieta: 'Nienaprawione' },
  { wartosc: 'w_trakcie', etykieta: 'W trakcie' },
  { wartosc: 'naprawione', etykieta: 'Naprawione' },
];

export default function EkranWizyty() {
  const router = useRouter();
  const { synchronizuj } = useAplikacja();
  const parametry = useLocalSearchParams<{ id: string }>();
  const wizytaId = String(parametry.id ?? '');

  const [wizyta, setWizyta] = useState<Wizyta | null>(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [zajety, setZajety] = useState(false);
  const [pytanieOUsuniecie, setPytanieOUsuniecie] = useState(false);
  const [usuwanie, setUsuwanie] = useState(false);

  const wczytaj = useCallback(async () => {
    setWizyta(await pobierzWizyte(wizytaId));
    setLadowanie(false);
  }, [wizytaId]);

  useFocusEffect(useCallback(() => {
    wczytaj();
    zapiszWDzienniku('otwarcie_wizyty', null, wizytaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizytaId]));

  const odswiez = useCallback(async () => {
    setOdswiezanie(true);
    await synchronizuj({ wymuszona: true });
    await wczytaj();
    setOdswiezanie(false);
  }, [synchronizuj, wczytaj]);

  const ustawStatus = useCallback(async (status: Status) => {
    if (!wizyta || wizyta.status === status) return;
    setZajety(true);
    await zmienStatusWizyty(wizyta.id, status);
    await odswiezLicznikiKolejki();
    await wczytaj();
    setZajety(false);
  }, [wizyta, wczytaj]);

  const usun = useCallback(async () => {
    if (!wizyta) return;
    setUsuwanie(true);
    await usunWizyte(wizyta.id);
    await odswiezLicznikiKolejki();
    setUsuwanie(false);
    setPytanieOUsuniecie(false);
    if (router.canGoBack()) router.back();
    else router.replace(`/klient/${wizyta.klient_id}`);
  }, [wizyta, router]);

  if (ladowanie) {
    return (
      <View style={style.ekran}>
        <Ladowanie tekst="Wczytywanie zgloszenia..." />
      </View>
    );
  }

  if (!wizyta || wizyta.usuniete_o) {
    return (
      <View style={style.ekran}>
        <KomunikatBledu
          tresc={'Nie ma tego zgloszenia na telefonie. Moglo zostac usuniete albo '
            + 'wypasc z okna synchronizacji (starsze naprawione zgloszenia nie sa '
            + 'trzymane na telefonie).'}
          onPonow={odswiez}
        />
      </View>
    );
  }

  const opis = opisStatusu(wizyta.status);
  const numer = wizyta.numer_oficjalny ?? wizyta.numer_roboczy ?? '';

  return (
    <View style={style.ekran}>
      <ScrollView
        style={style.przewijanie}
        contentContainerStyle={style.tresc}
        refreshControl={
          <RefreshControl
            refreshing={odswiezanie}
            onRefresh={odswiez}
            colors={[Kolory.akcent]}
            tintColor={Kolory.akcent}
          />
        }
      >
        <Stack.Screen options={{ title: numer ? `Zgloszenie ${numer}` : 'Zgloszenie' }} />


        {/* Naglowek w kolorze statusu */}
        <View
          style={[
            style.naglowek,
            { backgroundColor: opis.tlo, borderColor: opis.obramowanie, borderLeftColor: opis.kolor },
          ]}
        >
          <View style={[style.odznaka, { backgroundColor: opis.kolor }]}>
            <Text style={style.odznakaTekst}>{opis.etykieta}</Text>
          </View>
          {/* Swobodny opis auta wpisany przy zgloszeniu - moze byc wielolinijkowy. */}
          <Text style={style.auto} numberOfLines={3}>
            {wizyta.auto?.trim() || 'Auto nieokreslone'}
          </Text>
          <Text style={style.tytul}>{wizyta.tytul}</Text>
          {wizyta.opis ? <Text style={style.opisTekst}>{wizyta.opis}</Text> : null}
        </View>

        {/* Zmiana statusu */}
        <View style={style.karta}>
          <Text style={style.etykietaSekcji}>ZMIEN STATUS</Text>
          <View style={style.statusy}>
            {STATUSY.map((poz) => {
              const aktywny = wizyta.status === poz.wartosc;
              const kolory = opisStatusu(poz.wartosc);
              return (
                <Pressable
                  key={poz.wartosc}
                  onPress={() => ustawStatus(poz.wartosc)}
                  disabled={zajety}
                  style={[
                    style.status,
                    aktywny && { backgroundColor: kolory.kolor, borderColor: kolory.kolor },
                  ]}
                >
                  <Text style={[style.statusTekst, aktywny && style.statusTekstAktywny]}>
                    {poz.etykieta}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {zajety ? <ActivityIndicator style={style.wskaznik} color={Kolory.akcent} /> : null}
        </View>

        {/* Dane */}
        <View style={style.karta}>
          <Text style={style.etykietaSekcji}>SZCZEGOLY</Text>
          <Wiersz etykieta="Klient" wartosc={wizyta.klient_nazwa ?? '-'} />
          <Wiersz etykieta="Auto" wartosc={opisAuta(wizyta.auto)} />
          <Wiersz etykieta="Data przyjecia" wartosc={formatujDate(wizyta.data_wizyty)} />
          {wizyta.data_zamkniecia ? (
            <Wiersz etykieta="Data zamkniecia" wartosc={formatujDate(wizyta.data_zamkniecia)} />
          ) : null}
          <Wiersz etykieta="Priorytet" wartosc={ETYKIETA_PRIORYTETU[wizyta.priorytet] ?? '-'} />
          {wizyta.przebieg !== null && wizyta.przebieg !== undefined ? (
            <Wiersz etykieta="Przebieg" wartosc={formatujPrzebieg(wizyta.przebieg) ?? '-'} />
          ) : null}
          {wizyta.koszt !== null && wizyta.koszt !== undefined ? (
            <Wiersz etykieta="Koszt" wartosc={formatujKwote(wizyta.koszt) ?? '-'} />
          ) : null}
          {/* B5: numer roboczy widac od razu, oficjalny dochodzi po synchronizacji. */}
          {wizyta.numer_roboczy ? (
            <Wiersz etykieta="Numer roboczy" wartosc={wizyta.numer_roboczy} />
          ) : null}
          <Wiersz
            etykieta="Numer oficjalny"
            wartosc={wizyta.numer_oficjalny ?? 'zostanie nadany przy synchronizacji'}
          />
        </View>

        <Przycisk
          tytul="Usun zgloszenie"
          wariant="niebezpieczny"
          onPress={() => setPytanieOUsuniecie(true)}
        />
      </ScrollView>

      {pytanieOUsuniecie ? (
        <Potwierdzenie
          widoczne
          tytul="Usunac zgloszenie?"
          tresc={`"${wizyta.tytul}" zniknie z listy. Zgloszenie zostaje oznaczone jako `
            + 'usuniete i po okresie retencji kasuje je zadanie serwerowe - dzieki temu '
            + 'zmiana kolegi zrobiona w tym samym czasie nie przepadnie.'}
          tekstAkcji="Usun"
          tekstAnuluj="Anuluj"
          wariant="niebezpieczny"
          zajety={usuwanie}
          onAkcja={usun}
          onAnuluj={() => setPytanieOUsuniecie(false)}
        />
      ) : null}
    </View>
  );
}

function Wiersz({ etykieta, wartosc }: { etykieta: string; wartosc: string }) {
  return (
    <View style={style.wiersz}>
      <Text style={style.wierszEtykieta}>{etykieta}</Text>
      <Text style={style.wierszWartosc} numberOfLines={2}>{wartosc}</Text>
    </View>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  przewijanie: { flex: 1 },
  tresc: { padding: Odstepy.l, paddingBottom: wys(7, 32), gap: Odstepy.m },

  naglowek: {
    borderRadius: Zaokraglenia.l,
    borderWidth: 1,
    borderLeftWidth: s(8),
    padding: Odstepy.l,
    ...cien('mocny'),
  },
  odznaka: {
    alignSelf: 'flex-start',
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: Zaokraglenia.pelne,
    marginBottom: Odstepy.s,
  },
  odznakaTekst: { color: '#FFFFFF', fontSize: s(11), fontWeight: '800', letterSpacing: 0.7 },
  auto: { fontSize: s(13), fontWeight: '700', color: Kolory.tekstDrugi, marginBottom: 2 },
  tytul: { fontSize: s(22), lineHeight: s(28), fontWeight: '800', color: Kolory.tekst },
  opisTekst: {
    fontSize: s(15), lineHeight: s(21), color: Kolory.tekstDrugi, marginTop: Odstepy.s,
  },

  karta: {
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.l,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    padding: Odstepy.l,
  },
  etykietaSekcji: {
    fontSize: s(11), fontWeight: '800', letterSpacing: 0.8,
    color: Kolory.tekstSlaby, marginBottom: Odstepy.m,
  },
  statusy: { flexDirection: 'row', gap: Odstepy.s, flexWrap: 'wrap' },
  status: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    backgroundColor: Kolory.powierzchniaStonowana,
    borderRadius: Zaokraglenia.m,
    paddingVertical: s(11),
    paddingHorizontal: Odstepy.s,
    minHeight: CEL_DOTYKU,
  },
  statusTekst: { fontSize: s(13.5), fontWeight: '700', color: Kolory.tekstDrugi },
  statusTekstAktywny: { color: Kolory.tekstNaAkcencie },
  wskaznik: { marginTop: Odstepy.s },

  wiersz: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Odstepy.m,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Kolory.obramowanie,
  },
  wierszEtykieta: { fontSize: s(13), color: Kolory.tekstSlaby },
  wierszWartosc: {
    fontSize: s(14), fontWeight: '600', color: Kolory.tekst, flex: 1, textAlign: 'right',
  },
});
