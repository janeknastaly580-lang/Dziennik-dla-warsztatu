/**
 * WIDOK PROFILU KLIENTA.
 *
 *  1. Na samej gorze DUZY, wyrozniajacy sie przycisk "DODAJ" - nowa wizyta
 *     lub usterka tego klienta.
 *  2. Ponizej domyslnie PELNA historia ze WSZYSTKICH aut (zakladka
 *     "Wszystkie" aktywna od wejscia).
 *  3. Zakladki zawezaja historie do jednego auta. Powstaja z unikalnych
 *     opisow wpisanych przy wizytach - nie ma kartoteki pojazdow.
 *  4. Kafelki nienaprawionych sa znacznie wieksze niz naprawionych.
 *
 * B3 - jesli inny telefon zalozyl kartoteke z tym samym numerem telefonu,
 *      na gorze pojawia sie propozycja scalenia. Offline nie da sie tego
 *      wykryc automatycznie, wiec mechanik dostaje narzedzie do posprzatania.
 * A10 - wejscie na kartoteke ladzie w dzienniku dostepu.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Linking, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import KafelekWizyty from '../../komponenty/KafelekWizyty';
import ZakladkiAut from '../../komponenty/ZakladkiAut';
import Potwierdzenie from '../../komponenty/Potwierdzenie';
import { KomunikatBledu, Ladowanie, Pusto } from '../../komponenty/Stany';
import {
  klienciZTymSamymTelefonem, profilKlienta, scalKlientow, wizytyKlienta, zapiszWDzienniku,
} from '../../dane/repozytorium';
import { odswiezLicznikiKolejki } from '../../dane/synchronizacja';
import { useAplikacja } from '../../dane/kontekst';
import { formatujKwote } from '../../format';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../../motyw';
import { CEL_DOTYKU, s, wys } from '../../uklad';
import type { Klient, KlientNaLiscie, Wizyta } from '../../typy';

export default function EkranProfiluKlienta() {
  const router = useRouter();
  const { synchronizuj } = useAplikacja();
  const parametry = useLocalSearchParams<{ id: string }>();
  const klientId = String(parametry.id ?? '');

  const [klient, setKlient] = useState<Klient | null>(null);
  const [wizyty, setWizyty] = useState<Wizyta[]>([]);
  const [duplikaty, setDuplikaty] = useState<KlientNaLiscie[]>([]);
  const [wybraneAuto, setWybraneAuto] = useState<string | null>(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [ladowanieHistorii, setLadowanieHistorii] = useState(false);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [pytanieOScalenie, setPytanieOScalenie] = useState<KlientNaLiscie | null>(null);

  const wczytajHistorie = useCallback(async (auto: string | null) => {
    setLadowanieHistorii(true);
    setWizyty(await wizytyKlienta(klientId, auto));
    setLadowanieHistorii(false);
  }, [klientId]);

  const wczytajWszystko = useCallback(async () => {
    const dane = await profilKlienta(klientId);
    setKlient(dane);
    if (dane?.telefon) {
      const podobni = await klienciZTymSamymTelefonem(dane.telefon);
      setDuplikaty(podobni.filter((k) => k.id !== klientId));
    } else {
      setDuplikaty([]);
    }
    await wczytajHistorie(wybraneAuto);
    setLadowanie(false);
  }, [klientId, wybraneAuto, wczytajHistorie]);

  useFocusEffect(useCallback(() => {
    wczytajWszystko();
    zapiszWDzienniku('otwarcie_klienta', klientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klientId]));

  const odswiez = useCallback(async () => {
    setOdswiezanie(true);
    await synchronizuj({ wymuszona: true });
    await wczytajWszystko();
    setOdswiezanie(false);
  }, [synchronizuj, wczytajWszystko]);

  const wybierzAuto = useCallback((auto: string | null) => {
    setWybraneAuto(auto);
    wczytajHistorie(auto);
  }, [wczytajHistorie]);

  const scal = useCallback(async () => {
    if (!pytanieOScalenie) return;
    // Kartoteka otwarta na ekranie znika, wszystkie jej wizyty przechodza
    // do tej starszej. Serwer dostanie te sama operacje w kolejce.
    await scalKlientow(klientId, pytanieOScalenie.id);
    await odswiezLicznikiKolejki();
    const cel = pytanieOScalenie.id;
    setPytanieOScalenie(null);
    router.replace(`/klient/${cel}`);
  }, [pytanieOScalenie, klientId, router]);

  const otwarte = useMemo(
    () => wizyty.filter((w) => w.status !== 'naprawione').length,
    [wizyty],
  );

  if (ladowanie) {
    return (
      <View style={style.ekran}>
        <Stack.Screen options={{ title: 'Profil klienta' }} />
        <Ladowanie tekst="Wczytywanie profilu..." />
      </View>
    );
  }

  if (!klient) {
    return (
      <View style={style.ekran}>
        <Stack.Screen options={{ title: 'Profil klienta' }} />
        <KomunikatBledu
          tresc={'Nie znaleziono tej kartoteki na telefonie. Mogla zostac usunieta '
            + 'albo wypasc z okna synchronizacji.'}
          onPonow={odswiez}
        />
      </View>
    );
  }

  const auta = klient.auta ?? [];

  const naglowek = (
    <View>

      {/* B3: propozycja scalenia duplikatu zalozonego na innym telefonie */}
      {duplikaty.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => setPytanieOScalenie(d)}
          style={style.duplikat}
        >
          <Text style={style.duplikatTytul}>Mozliwy duplikat kartoteki</Text>
          <Text style={style.duplikatTekst}>
            {'"'}{d.nazwa}{'"'} ma ten sam numer telefonu ({d.liczba_wizyt} wizyt).
            Dotknij, zeby scalic obie kartoteki.
          </Text>
        </Pressable>
      ))}

      {/* ---------- 1. DUZY PRZYCISK "DODAJ" NA SAMEJ GORZE ---------- */}
      <Pressable
        onPress={() => router.push(`/wizyta/nowa?klientId=${klient.id}`)}
        accessibilityRole="button"
        accessibilityLabel="Dodaj nowa wizyte lub usterke"
        style={({ pressed }) => [style.duzyDodaj, pressed && style.duzyDodajWcisniety]}
      >
        <View style={style.duzyDodajPlus}>
          <Text style={style.duzyDodajPlusTekst}>+</Text>
        </View>
        <View style={style.duzyDodajTresc}>
          <Text style={style.duzyDodajTytul}>DODAJ</Text>
          <Text style={style.duzyDodajOpis}>Nowa wizyta lub usterka tego klienta</Text>
        </View>
      </Pressable>

      {/* ---------- 2. Dane klienta ---------- */}
      <View style={style.karta}>
        <Text style={style.nazwaKlienta}>{klient.nazwa}</Text>

        <View style={style.kontakt}>
          {klient.telefon ? (
            <Pressable onPress={() => Linking.openURL(`tel:${klient.telefon}`)}>
              <Text style={style.telefon}>{klient.telefon}</Text>
            </Pressable>
          ) : null}
          {klient.email ? <Text style={style.kontaktTekst}>{klient.email}</Text> : null}
          {klient.adres ? <Text style={style.kontaktTekst}>{klient.adres}</Text> : null}
        </View>

        {klient.notatki ? <Text style={style.notatki}>{klient.notatki}</Text> : null}

        {/* Edycja kartoteki. Celowo dyskretna - dominowac ma "DODAJ" wyzej,
            bo dopisywanie zgloszen to codziennosc, a poprawianie danych
            kontaktowych zdarza sie raz na jakis czas. */}
        <Pressable
          onPress={() => router.push(`/klient/edytuj?id=${klient.id}`)}
          accessibilityRole="button"
          accessibilityLabel="Edytuj dane klienta"
          style={({ pressed }) => [style.edytuj, pressed && style.edytujWcisniety]}
        >
          <Text style={style.edytujTekst}>Edytuj dane klienta</Text>
        </Pressable>

        <View style={style.statystyki}>
          <Statystyka
            wartosc={String(klient.statystyki?.otwarte ?? 0)}
            opis="nienaprawione" kolor={Kolory.pilne}
          />
          <Statystyka
            wartosc={String(klient.statystyki?.naprawione ?? 0)}
            opis="naprawione" kolor={Kolory.ok}
          />
          <Statystyka wartosc={String(auta.length)} opis="auta" kolor={Kolory.akcent} />
          <Statystyka
            wartosc={formatujKwote(klient.statystyki?.koszt_razem) ?? '-'}
            opis="razem" kolor={Kolory.tekstDrugi}
          />
        </View>
      </View>

      {/* ---------- 3. Zakladki filtrowania po aucie ---------- */}
      <Text style={style.etykietaSekcji}>FILTRUJ WEDLUG AUTA</Text>
      <ZakladkiAut
        auta={auta}
        wybrane={wybraneAuto}
        onWybor={wybierzAuto}
        liczbaWszystkich={klient.statystyki?.wizyty_razem ?? 0}
      />

      {/* ---------- 4. Naglowek historii ---------- */}
      <View style={style.naglowekHistorii}>
        <Text style={style.tytulHistorii} numberOfLines={1}>
          {wybraneAuto === null ? 'Historia wszystkich aut' : 'Historia wybranego auta'}
        </Text>
        <View style={style.podsumowanie}>
          {ladowanieHistorii ? (
            <ActivityIndicator size="small" color={Kolory.akcent} />
          ) : (
            <Text style={style.podsumowanieTekst}>
              {wizyty.length} poz.{otwarte > 0 ? `  ·  ${otwarte} otwartych` : ''}
            </Text>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={style.ekran}>
      <Stack.Screen options={{ title: klient.nazwa }} />

      <FlatList
        data={wizyty}
        keyExtractor={(w) => w.id}
        ListHeaderComponent={naglowek}
        renderItem={({ item }) => (
          <KafelekWizyty
            wizyta={item}
            ukryjAuto={wybraneAuto !== null}
            onPress={() => router.push(`/wizyta/${item.id}`)}
          />
        )}
        contentContainerStyle={style.lista}
        refreshControl={
          <RefreshControl
            refreshing={odswiezanie}
            onRefresh={odswiez}
            colors={[Kolory.akcent]}
            tintColor={Kolory.akcent}
          />
        }
        ListEmptyComponent={
          ladowanieHistorii ? null : (
            <Pusto
              tytul={wybraneAuto === null
                ? 'Brak wizyt w historii'
                : 'To auto nie ma jeszcze zadnej wizyty'}
            />
          )
        }
      />

      {pytanieOScalenie ? (
        <Potwierdzenie
          widoczne
          tytul="Scalic kartoteki?"
          tresc={`Wszystkie wizyty z "${klient.nazwa}" przejda do "${pytanieOScalenie.nazwa}", `
            + 'a ta kartoteka zostanie zamknieta. Operacja trafi tez na serwer.'}
          tekstAkcji="Scal"
          tekstAnuluj="Anuluj"
          onAkcja={scal}
          onAnuluj={() => setPytanieOScalenie(null)}
        />
      ) : null}
    </View>
  );
}

function Statystyka({ wartosc, opis, kolor }: { wartosc: string; opis: string; kolor: string }) {
  return (
    <View style={style.statystyka}>
      <Text style={[style.statystykaWartosc, { color: kolor }]} numberOfLines={1}>{wartosc}</Text>
      <Text style={style.statystykaOpis}>{opis}</Text>
    </View>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  lista: { padding: Odstepy.l, paddingBottom: wys(6, 32) },

  duplikat: {
    backgroundColor: Kolory.wTrakcieTlo,
    borderWidth: 1,
    borderColor: Kolory.wTrakcieObramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  duplikatTytul: { fontSize: s(13), fontWeight: '800', color: Kolory.wTrakcie },
  duplikatTekst: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.tekstDrugi, marginTop: 2 },

  /* Duzy przycisk dodawania - celowo dominuje na gorze ekranu. */
  duzyDodaj: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Kolory.akcent,
    borderRadius: Zaokraglenia.xl,
    paddingVertical: Odstepy.l,
    paddingHorizontal: Odstepy.l,
    marginBottom: Odstepy.l,
    minHeight: wys(11, 84, 120),
    ...cien('mocny'),
  },
  duzyDodajWcisniety: { backgroundColor: Kolory.akcentCiemny },
  duzyDodajPlus: {
    width: s(50), height: s(50), borderRadius: Zaokraglenia.pelne,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', marginRight: Odstepy.l,
  },
  duzyDodajPlusTekst: {
    fontSize: s(32), lineHeight: s(36), fontWeight: '300', color: Kolory.tekstNaAkcencie,
  },
  duzyDodajTresc: { flex: 1 },
  duzyDodajTytul: {
    fontSize: s(24), fontWeight: '900', letterSpacing: 1.2, color: Kolory.tekstNaAkcencie,
  },
  duzyDodajOpis: { fontSize: s(13), color: 'rgba(255,255,255,0.9)', marginTop: 2 },

  karta: {
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.l,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    padding: Odstepy.l,
    marginBottom: Odstepy.l,
    ...cien('lekki'),
  },
  nazwaKlienta: { fontSize: s(20), fontWeight: '800', color: Kolory.tekst },
  kontakt: { marginTop: Odstepy.s, gap: 2 },
  telefon: { fontSize: s(15), fontWeight: '700', color: Kolory.akcent },
  kontaktTekst: { fontSize: s(14), color: Kolory.tekstDrugi },
  notatki: {
    fontSize: s(13.5), color: Kolory.tekstDrugi, fontStyle: 'italic', marginTop: Odstepy.s,
  },
  edytuj: {
    alignSelf: 'flex-start',
    marginTop: Odstepy.m,
    paddingVertical: s(8),
    paddingHorizontal: Odstepy.m,
    borderRadius: Zaokraglenia.pelne,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    backgroundColor: Kolory.powierzchniaStonowana,
    minHeight: CEL_DOTYKU,
    justifyContent: 'center',
  },
  edytujWcisniety: { backgroundColor: Kolory.akcentTlo, borderColor: Kolory.akcent },
  edytujTekst: { fontSize: s(13.5), fontWeight: '700', color: Kolory.akcent },

  statystyki: {
    flexDirection: 'row', marginTop: Odstepy.l,
    borderTopWidth: 1, borderTopColor: Kolory.obramowanie, paddingTop: Odstepy.m,
  },
  statystyka: { flex: 1, alignItems: 'center' },
  statystykaWartosc: { fontSize: s(17), fontWeight: '800' },
  statystykaOpis: { fontSize: s(10.5), color: Kolory.tekstSlaby, marginTop: 1 },

  etykietaSekcji: {
    fontSize: s(11), fontWeight: '800', letterSpacing: 0.8,
    color: Kolory.tekstSlaby, marginBottom: Odstepy.s,
  },
  naglowekHistorii: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Odstepy.s, marginTop: Odstepy.l, marginBottom: Odstepy.m,
  },
  tytulHistorii: { fontSize: s(16), fontWeight: '800', color: Kolory.tekst, flex: 1 },
  podsumowanie: { minWidth: s(60), alignItems: 'flex-end' },
  podsumowanieTekst: { fontSize: s(12), fontWeight: '600', color: Kolory.tekstSlaby },
});
