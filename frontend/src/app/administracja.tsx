/**
 * EKRAN ZARZADZANIA DOSTEPEM - widoczny wylacznie dla administratora warsztatu.
 *
 * Administrator to zwykly mechanik z rola "administrator". Ponad innych moze
 * DOKLADNIE tyle:
 *
 *   1. PRZYZNAC DOSTEP telefonowi - zdalnie, jednorazowym kodem z jego ekranu,
 *      bez podawania jakiegokolwiek hasla. Telefon zaraz potem sam prosi
 *      mechanika o ustawienie wlasnego hasla.
 *   2. ODEBRAC DOSTEP - mechanikowi (wszystkie jego telefony) albo pojedynczemu
 *      telefonowi. Zablokowany telefon czysci lokalna baze przy najblizszym
 *      kontakcie z serwerem.
 *
 * Nie widzi tu ani jednej kartoteki klienta - to nie jest "wglad we wszystko",
 * tylko zarzadzanie dostepem.
 *
 * Uprawnienia sa sprawdzane po stronie serwera (funkcja brzegowa ORAZ kazda
 * funkcja w bazie). Ten ekran tylko chowa przyciski - sam z siebie niczego
 * nie autoryzuje.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { KomunikatFormularza, Pole, Przycisk, Sekcja } from '../komponenty/Formularz';
import Potwierdzenie from '../komponenty/Potwierdzenie';
import { KomunikatBledu, Ladowanie } from '../komponenty/Stany';
import {
  akcjaNaUrzadzeniu, DaneAdmina, daneAdmina, dodajMechanika, MechanikAdmina,
  odblokujMechanika, przyznajDostep, UrzadzenieAdmina, zablokujMechanika, BladSieci,
} from '../dane/chmura';
import { pobierzToken } from '../dane/sesja';
import { useAplikacja } from '../dane/kontekst';
import { Kolory, Odstepy, Zaokraglenia, cien } from '../motyw';
import { CEL_DOTYKU, s, wys } from '../uklad';

type Pytanie =
  | { rodzaj: 'zablokuj_mechanika'; mechanik: MechanikAdmina }
  | { rodzaj: 'wyrejestruj'; urzadzenie: UrzadzenieAdmina; mechanik: MechanikAdmina };

function czasLokalny(iso: string | null): string {
  if (!iso) return 'jeszcze nie synchronizowal';
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

export default function EkranAdministracji() {
  const router = useRouter();
  const { czyAdministrator } = useAplikacja();

  const [dane, setDane] = useState<DaneAdmina | null>(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [zajety, setZajety] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [sukces, setSukces] = useState<string | null>(null);

  const [kod, setKod] = useState('');
  const [wybranyMechanik, setWybranyMechanik] = useState<string | null>(null);
  const [noweImie, setNoweImie] = useState('');
  const [pytanie, setPytanie] = useState<Pytanie | null>(null);

  const wczytaj = useCallback(async (cichoBlad = false) => {
    try {
      const token = await pobierzToken();
      if (!token) throw new BladSieci('Brak sesji na tym telefonie.');
      const odp = await daneAdmina(token);
      setDane(odp);
      if (!cichoBlad) setBlad(null);
    } catch (err) {
      setBlad(err instanceof BladSieci
        ? 'Zarzadzanie dostepem wymaga internetu. Dane klientow dzialaja dalej bez sieci.'
        : 'Nie udalo sie pobrac listy. Sprobuj ponownie.');
    } finally {
      setLadowanie(false);
      setOdswiezanie(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  // Telefony zglaszaja sie w tle - lista odswieza sie sama, zeby administrator
  // nie musial zgadywac, kiedy kod mechanika sie pojawi.
  useEffect(() => {
    const licznik = setInterval(() => wczytaj(true), 15_000);
    return () => clearInterval(licznik);
  }, [wczytaj]);

  /** Wspolna obsluga akcji: token, komunikat, odswiezenie listy. */
  const wykonaj = useCallback(async (
    akcja: (token: string) => Promise<{ ok: boolean; blad?: string }>,
    komunikat: string,
  ) => {
    setZajety(true);
    setBlad(null);
    setSukces(null);
    try {
      const token = await pobierzToken();
      if (!token) throw new BladSieci('Brak sesji na tym telefonie.');
      const wynik = await akcja(token);
      if (!wynik.ok) {
        setBlad(wynik.blad ?? 'Nie udalo sie wykonac tej operacji.');
        return false;
      }
      setSukces(komunikat);
      await wczytaj();
      return true;
    } catch (err) {
      setBlad(err instanceof BladSieci
        ? 'Ta operacja wymaga internetu.'
        : 'Nie udalo sie wykonac tej operacji.');
      return false;
    } finally {
      setZajety(false);
    }
  }, [wczytaj]);

  const przyznaj = useCallback(async () => {
    if (!kod.trim()) {
      setBlad('Wpisz kod z ekranu telefonu mechanika.');
      return;
    }
    if (!wybranyMechanik) {
      setBlad('Wybierz, ktoremu mechanikowi przyznajesz dostep.');
      return;
    }
    const udane = await wykonaj(
      (t) => przyznajDostep(t, kod.trim().toUpperCase(), wybranyMechanik),
      'Dostep przyznany. Telefon odbierze go w kilka sekund i poprosi o ustawienie hasla.',
    );
    if (udane) { setKod(''); setWybranyMechanik(null); }
  }, [kod, wybranyMechanik, wykonaj]);

  const dodaj = useCallback(async () => {
    if (!noweImie.trim()) {
      setBlad('Podaj imie i nazwisko mechanika.');
      return;
    }
    const udane = await wykonaj(
      (t) => dodajMechanika(t, noweImie.trim()),
      'Konto zalozone. Teraz przyznaj dostep telefonowi tego mechanika.',
    );
    if (udane) setNoweImie('');
  }, [noweImie, wykonaj]);

  /* -------------------------------- widok ------------------------------- */

  if (!czyAdministrator) {
    return (
      <View style={style.ekran}>
        <Stack.Screen options={{ title: 'Dostep' }} />
        <KomunikatBledu
          tresc={'Ten ekran jest dostepny tylko dla administratora warsztatu.'}
          onPonow={() => router.replace('/')}
        />
      </View>
    );
  }

  if (ladowanie) {
    return (
      <View style={style.ekran}>
        <Stack.Screen options={{ title: 'Dostep' }} />
        <Ladowanie tekst="Wczytywanie listy mechanikow..." />
      </View>
    );
  }

  return (
    <ScrollView
      style={style.ekran}
      contentContainerStyle={style.tresc}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={odswiezanie}
          onRefresh={() => { setOdswiezanie(true); wczytaj(); }}
          colors={[Kolory.akcent]}
          tintColor={Kolory.akcent}
        />
      }
    >
      <Stack.Screen options={{ title: dane?.warsztat?.nazwa ?? 'Dostep' }} />

      <KomunikatFormularza tresc={blad} />
      {sukces ? (
        <View style={style.sukces}>
          <Text style={style.sukcesTekst}>{sukces}</Text>
        </View>
      ) : null}

      {/* ============ 1. PRZYZNANIE DOSTEPU ============ */}
      <Sekcja tytul="TELEFONY CZEKAJACE NA DOSTEP">
        <Text style={style.opis}>
          Mechanik uruchamia aplikacje i odczytuje Ci kod ze swojego ekranu.
          Dotknij kodu ponizej albo wpisz go recznie, wskaz mechanika i zatwierdz.
          Zadnego hasla nie podajesz - telefon sam poprosi mechanika o ustawienie
          wlasnego.
        </Text>

        {dane?.oczekujace?.length ? dane.oczekujace.map((u) => (
          <Pressable
            key={u.kod}
            onPress={() => setKod(u.kod)}
            style={({ pressed }) => [style.oczekujace, pressed && style.wcisniety]}
          >
            <Text style={style.kodTekst}>{u.kod}</Text>
            <View style={style.oczekujaceOpis}>
              <Text style={style.oczekujaceNazwa} numberOfLines={1}>
                {u.nazwa ?? 'telefon'} · {u.platforma ?? '?'}
              </Text>
              <Text style={style.drobne}>
                zgloszony {czasLokalny(u.zgloszone_o)}
              </Text>
            </View>
          </Pressable>
        )) : (
          <Text style={style.pusto}>
            Zaden telefon nie czeka. Popros mechanika, zeby otworzyl aplikacje.
          </Text>
        )}

        <Pole
          etykieta="Kod z ekranu telefonu"
          value={kod}
          onChangeText={(t) => setKod(t.toUpperCase())}
          placeholder="np. 88FVB9D9"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />

        <Text style={style.etykieta}>KOMU PRZYZNAC</Text>
        <View style={style.wybor}>
          {(dane?.mechanicy ?? []).filter((m) => !m.zablokowany_o).map((m) => {
            const aktywny = wybranyMechanik === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setWybranyMechanik(aktywny ? null : m.id)}
                style={[style.opcja, aktywny && style.opcjaAktywna]}
              >
                <Text style={[style.opcjaTekst, aktywny && style.opcjaTekstAktywny]}>
                  {m.imie}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Przycisk tytul="Przyznaj dostep" onPress={przyznaj} zajety={zajety} />
      </Sekcja>

      {/* ============ 2. MECHANICY I ICH TELEFONY ============ */}
      <Sekcja tytul="MECHANICY">
        {(dane?.mechanicy ?? []).map((m) => (
          <View key={m.id} style={[style.karta, m.zablokowany_o && style.kartaZablokowana]}>
            <View style={style.naglowekKarty}>
              <View style={style.naglowekTresc}>
                <Text style={style.imie} numberOfLines={1}>
                  {m.imie}{m.to_ja ? ' (Ty)' : ''}
                </Text>
                <Text style={m.zablokowany_o ? style.stanZly : style.stanOk}>
                  {m.zablokowany_o
                    ? `dostep odebrany${m.powod_blokady ? `: ${m.powod_blokady}` : ''}`
                    : m.rola === 'administrator' ? 'administrator' : 'aktywny'}
                </Text>
              </View>

              {m.to_ja ? null : m.zablokowany_o ? (
                <Pressable
                  onPress={() => wykonaj((t) => odblokujMechanika(t, m.id),
                    'Dostep przywrocony. Telefon wroci do pracy bez ponownego parowania.')}
                  style={({ pressed }) => [style.maly, pressed && style.wcisniety]}
                >
                  <Text style={style.malyTekst}>Przywroc</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setPytanie({ rodzaj: 'zablokuj_mechanika', mechanik: m })}
                  style={({ pressed }) => [style.maly, style.malyZly, pressed && style.wcisniety]}
                >
                  <Text style={[style.malyTekst, style.malyTekstZly]}>Odbierz dostep</Text>
                </Pressable>
              )}
            </View>

            {m.urzadzenia.length === 0 ? (
              <Text style={style.drobne}>Brak sparowanego telefonu.</Text>
            ) : m.urzadzenia.map((u) => (
              <View key={u.id} style={style.urzadzenie}>
                <Text style={style.drobne} numberOfLines={2}>
                  {u.nazwa ?? 'telefon'} ({u.platforma ?? '?'}, {u.wersja ?? '?'})
                  {'\n'}ostatnia synchronizacja: {czasLokalny(u.ostatnia_sync_o)}
                  {u.zablokowane_o ? '\ntelefon zablokowany' : ''}
                  {u.czeka_na_haslo ? '\nczeka na ustawienie hasla' : ''}
                </Text>
                <View style={style.akcje}>
                  <Pressable
                    onPress={() => wykonaj((t) => akcjaNaUrzadzeniu(t, u.id, 'reset_hasla'),
                      'Przy najblizszym uruchomieniu telefon poprosi o nowe haslo.')}
                    style={({ pressed }) => [style.maly, pressed && style.wcisniety]}
                  >
                    <Text style={style.malyTekst}>Nowe haslo</Text>
                  </Pressable>

                  {u.zablokowane_o ? (
                    <Pressable
                      onPress={() => wykonaj((t) => akcjaNaUrzadzeniu(t, u.id, 'odblokuj'),
                        'Telefon odblokowany.')}
                      style={({ pressed }) => [style.maly, pressed && style.wcisniety]}
                    >
                      <Text style={style.malyTekst}>Odblokuj</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => wykonaj((t) => akcjaNaUrzadzeniu(t, u.id, 'zablokuj'),
                        'Telefon zablokowany. Wyczysci dane przy najblizszym polaczeniu.')}
                      style={({ pressed }) => [style.maly, style.malyZly, pressed && style.wcisniety]}
                    >
                      <Text style={[style.malyTekst, style.malyTekstZly]}>Zablokuj</Text>
                    </Pressable>
                  )}

                  <Pressable
                    onPress={() => setPytanie({ rodzaj: 'wyrejestruj', urzadzenie: u, mechanik: m })}
                    style={({ pressed }) => [style.maly, style.malyZly, pressed && style.wcisniety]}
                  >
                    <Text style={[style.malyTekst, style.malyTekstZly]}>Zgubiony</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}

        <Pole
          etykieta="Nowy mechanik"
          value={noweImie}
          onChangeText={setNoweImie}
          placeholder="Imie i nazwisko"
        />
        <Przycisk tytul="Zaloz konto" wariant="drugi" onPress={dodaj} zajety={zajety} />
      </Sekcja>

      {zajety ? <ActivityIndicator color={Kolory.akcent} /> : null}

      <Text style={style.stopka}>
        Zarzadzanie dostepem wymaga internetu. Praca na kartotekach klientow
        dziala dalej bez zasiegu.
      </Text>

      {pytanie ? (
        <Potwierdzenie
          widoczne
          tytul={pytanie.rodzaj === 'zablokuj_mechanika'
            ? 'Odebrac dostep?'
            : 'Wyrejestrowac telefon?'}
          tresc={pytanie.rodzaj === 'zablokuj_mechanika'
            ? `${pytanie.mechanik.imie} straci dostep natychmiast. Wszystkie jego telefony `
              + 'skasuja dane warsztatu przy najblizszym polaczeniu z internetem. '
              + 'Dostep mozna pozniej przywrocic.'
            : `Telefon ${pytanie.urzadzenie.nazwa ?? ''} zostanie odciety na stale i skasuje `
              + 'dane. Zeby wrocic do pracy, bedzie musial przejsc parowanie od nowa.'}
          tekstAkcji={pytanie.rodzaj === 'zablokuj_mechanika' ? 'Odbierz dostep' : 'Wyrejestruj'}
          tekstAnuluj="Anuluj"
          wariant="niebezpieczny"
          zajety={zajety}
          onAkcja={async () => {
            const p = pytanie;
            setPytanie(null);
            if (p.rodzaj === 'zablokuj_mechanika') {
              await wykonaj((t) => zablokujMechanika(t, p.mechanik.id),
                'Dostep odebrany.');
            } else {
              await wykonaj((t) => akcjaNaUrzadzeniu(t, p.urzadzenie.id, 'wyrejestruj'),
                'Telefon wyrejestrowany.');
            }
          }}
          onAnuluj={() => setPytanie(null)}
        />
      ) : null}
    </ScrollView>
  );
}

const style = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: Kolory.tlo },
  tresc: { padding: Odstepy.l, paddingBottom: wys(8, 32) },

  opis: { fontSize: s(13), lineHeight: s(19), color: Kolory.tekstDrugi, marginBottom: Odstepy.m },
  drobne: { fontSize: s(12), lineHeight: s(17), color: Kolory.tekstSlaby },
  pusto: {
    fontSize: s(13), color: Kolory.tekstSlaby, fontStyle: 'italic', marginBottom: Odstepy.m,
  },
  etykieta: {
    fontSize: s(11), fontWeight: '800', letterSpacing: 0.6,
    color: Kolory.tekstSlaby, marginBottom: Odstepy.s,
  },

  sukces: {
    backgroundColor: Kolory.okTlo,
    borderWidth: 1,
    borderColor: Kolory.okObramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  sukcesTekst: { fontSize: s(13), lineHeight: s(19), color: Kolory.ok },

  oczekujace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Odstepy.m,
    backgroundColor: Kolory.akcentTlo,
    borderWidth: 1,
    borderColor: Kolory.akcent,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.s,
    minHeight: CEL_DOTYKU,
  },
  wcisniety: { opacity: 0.7 },
  kodTekst: {
    fontSize: s(18), fontWeight: '900', letterSpacing: 2, color: Kolory.akcentCiemny,
  },
  oczekujaceOpis: { flex: 1, minWidth: 0 },
  oczekujaceNazwa: { fontSize: s(13), fontWeight: '700', color: Kolory.tekst },

  wybor: { flexDirection: 'row', flexWrap: 'wrap', gap: Odstepy.s, marginBottom: Odstepy.m },
  opcja: {
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: Odstepy.m,
    justifyContent: 'center',
    minHeight: CEL_DOTYKU,
  },
  opcjaAktywna: { backgroundColor: Kolory.akcent, borderColor: Kolory.akcent },
  opcjaTekst: { fontSize: s(14), fontWeight: '700', color: Kolory.tekstDrugi },
  opcjaTekstAktywny: { color: Kolory.tekstNaAkcencie },

  karta: {
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    borderRadius: Zaokraglenia.l,
    padding: Odstepy.m,
    marginBottom: Odstepy.s,
    ...cien('lekki'),
  },
  kartaZablokowana: { backgroundColor: Kolory.pilneTlo, borderColor: Kolory.pilneObramowanie },
  naglowekKarty: {
    flexDirection: 'row', alignItems: 'center', gap: Odstepy.s, marginBottom: Odstepy.s,
  },
  naglowekTresc: { flex: 1, minWidth: 0 },
  imie: { fontSize: s(16), fontWeight: '800', color: Kolory.tekst },
  stanOk: { fontSize: s(12), fontWeight: '600', color: Kolory.ok, marginTop: 1 },
  stanZly: { fontSize: s(12), fontWeight: '600', color: Kolory.pilne, marginTop: 1 },

  urzadzenie: {
    borderTopWidth: 1,
    borderTopColor: Kolory.obramowanie,
    paddingTop: Odstepy.s,
    marginTop: Odstepy.s,
  },
  akcje: { flexDirection: 'row', flexWrap: 'wrap', gap: Odstepy.s, marginTop: Odstepy.s },
  maly: {
    borderWidth: 1,
    borderColor: Kolory.akcent,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: Odstepy.m,
    justifyContent: 'center',
    minHeight: s(36),
  },
  malyZly: { borderColor: Kolory.pilneObramowanie },
  malyTekst: { fontSize: s(12.5), fontWeight: '700', color: Kolory.akcent },
  malyTekstZly: { color: Kolory.pilne },

  stopka: {
    fontSize: s(12), lineHeight: s(17), color: Kolory.tekstSlaby, marginTop: Odstepy.m,
  },
});
