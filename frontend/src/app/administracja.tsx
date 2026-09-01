/**
 * EKRAN ZARZADZANIA DOSTEPEM - widoczny wylacznie dla administratora warsztatu.
 *
 * Administrator to zwykly mechanik z rola "administrator". W warsztacie jest
 * DOKLADNIE JEDEN - pilnuje tego indeks unikalny w bazie, a nie tylko ten
 * ekran. Ponad innych moze dokladnie tyle:
 *
 *   1. ZATWIERDZIC STANOWISKO czekajace na dostep - jednym przyciskiem. Nie
 *      wpisuje ani jednego znaku: imie i nazwisko podal juz sam mechanik na
 *      swoim komputerze, a konto zaklada sie z tego imienia. Program zaraz
 *      potem sam prosi mechanika o ustawienie wlasnego hasla.
 *   2. ODEBRAC DOSTEP - mechanikowi (wszystkie jego stanowiska) albo
 *      pojedynczemu komputerowi. Zablokowane stanowisko czysci lokalna baze
 *      przy najblizszym kontakcie z serwerem.
 *
 * Samego siebie zablokowac nie moze - ani swojego konta, ani komputera,
 * na ktorym wlasnie stoi. Warsztat bez administratora nie mialby juz nikogo,
 * kto wpuscilby kogokolwiek z powrotem.
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

import { KomunikatFormularza, Sekcja } from '../komponenty/Formularz';
import Potwierdzenie from '../komponenty/Potwierdzenie';
import { KomunikatBledu, Ladowanie } from '../komponenty/Stany';
import {
  akcjaNaUrzadzeniu, DaneAdmina, daneAdmina, MechanikAdmina, odblokujMechanika,
  UrzadzenieAdmina, zablokujMechanika, zatwierdzUrzadzenie, BladSieci,
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

  const [pytanie, setPytanie] = useState<Pytanie | null>(null);

  const wczytaj = useCallback(async (cichoBlad = false) => {
    try {
      const token = await pobierzToken();
      if (!token) throw new BladSieci('Brak sesji na tym komputerze.');
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

  // Stanowiska zglaszaja sie w tle - lista odswieza sie sama, zeby administrator
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
      if (!token) throw new BladSieci('Brak sesji na tym komputerze.');
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

  /** Jedyna czynnosc przy wpuszczaniu kogos do systemu: jedno dotkniecie. */
  const zatwierdz = useCallback((u: { kod: string; imie: string | null }) => wykonaj(
    (t) => zatwierdzUrzadzenie(t, u.kod),
    `${u.imie ?? 'Stanowisko'} ma juz dostep. Program odbierze go w kilka sekund `
      + 'i poprosi o ustawienie wlasnego hasla.',
  ), [wykonaj]);

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

      {/* ============ 1. ZATWIERDZANIE JEDNYM KLIKIEM ============ */}
      <Sekcja tytul="PROSBY O DOSTEP">
        <Text style={style.opis}>
          Mechanik podaje na swoim komputerze imie i nazwisko i prosi o dostep.
          Ty tylko sprawdzasz, czy to rzeczywiscie ta osoba, i klikasz
          {' '}Zatwierdz. Konto zalozy sie samo.
        </Text>

        {dane?.oczekujace?.length ? dane.oczekujace.map((u) => (
          <View key={u.kod} style={style.oczekujace}>
            <View style={style.oczekujaceOpis}>
              <Text style={style.oczekujaceImie} numberOfLines={2}>
                {u.imie ?? 'Stanowisko bez podanego imienia'}
              </Text>
              <Text style={style.drobne} numberOfLines={2}>
                {u.nazwa ?? 'komputer'} · {u.platforma ?? '?'}
                {'\n'}prosba nr {u.kod} · {czasLokalny(u.zgloszone_o)}
              </Text>
            </View>

            <Pressable
              onPress={() => zatwierdz(u)}
              disabled={zajety || !u.imie}
              accessibilityRole="button"
              accessibilityLabel={`Zatwierdz dostep dla ${u.imie ?? 'tego stanowiska'}`}
              style={({ pressed }) => [
                style.zatwierdz,
                (zajety || !u.imie) && style.zatwierdzNieaktywny,
                pressed && style.wcisniety,
              ]}
            >
              <Text style={style.zatwierdzTekst}>Zatwierdz</Text>
            </Pressable>
          </View>
        )) : (
          <Text style={style.pusto}>
            Nikt nie czeka. Popros mechanika, zeby otworzyl aplikacje i wpisal
            swoje imie i nazwisko.
          </Text>
        )}
      </Sekcja>

      {/* ============ 2. MECHANICY I ICH STANOWISKA ============ */}
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
                    'Dostep przywrocony. Stanowisko wroci do pracy bez ponownego parowania.')}
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
              <Text style={style.drobne}>Brak sparowanego stanowiska.</Text>
            ) : m.urzadzenia.map((u) => (
              <View key={u.id} style={style.urzadzenie}>
                <Text style={style.drobne} numberOfLines={2}>
                  {u.nazwa ?? 'komputer'} ({u.platforma ?? '?'}, {u.wersja ?? '?'})
                  {'\n'}ostatnia synchronizacja: {czasLokalny(u.ostatnia_sync_o)}
                  {u.zablokowane_o ? '\nstanowisko zablokowane' : ''}
                  {u.czeka_na_haslo ? '\nczeka na ustawienie hasla' : ''}
                </Text>
                <View style={style.akcje}>
                  <Pressable
                    onPress={() => wykonaj((t) => akcjaNaUrzadzeniu(t, u.id, 'reset_hasla'),
                      'Przy najblizszym uruchomieniu program poprosi o nowe haslo.')}
                    style={({ pressed }) => [style.maly, pressed && style.wcisniety]}
                  >
                    <Text style={style.malyTekst}>Nowe haslo</Text>
                  </Pressable>

                  {/* Na wlasnym stanowisku nie ma czego odcinac - administrator
                      odcialby sam siebie od jedynego miejsca, z ktorego mozna
                      komukolwiek przywrocic dostep. Serwer odmawia tego tak
                      samo; tu po prostu nie pokazujemy pulapki. */}
                  {m.to_ja ? null : u.zablokowane_o ? (
                    <Pressable
                      onPress={() => wykonaj((t) => akcjaNaUrzadzeniu(t, u.id, 'odblokuj'),
                        'Stanowisko odblokowane.')}
                      style={({ pressed }) => [style.maly, pressed && style.wcisniety]}
                    >
                      <Text style={style.malyTekst}>Odblokuj</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => wykonaj((t) => akcjaNaUrzadzeniu(t, u.id, 'zablokuj'),
                        'Stanowisko zablokowane. Wyczysci dane przy najblizszym polaczeniu.')}
                      style={({ pressed }) => [style.maly, style.malyZly, pressed && style.wcisniety]}
                    >
                      <Text style={[style.malyTekst, style.malyTekstZly]}>Zablokuj</Text>
                    </Pressable>
                  )}

                  {m.to_ja ? null : (
                    <Pressable
                      onPress={() => setPytanie({ rodzaj: 'wyrejestruj', urzadzenie: u, mechanik: m })}
                      style={({ pressed }) => [style.maly, style.malyZly, pressed && style.wcisniety]}
                    >
                      <Text style={[style.malyTekst, style.malyTekstZly]}>Zgubiony</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))}

        <Text style={style.drobne}>
          Kont nie zaklada sie tutaj recznie - powstaja same przy zatwierdzaniu
          prosby o dostep.
        </Text>
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
            : 'Wyrejestrowac stanowisko?'}
          tresc={pytanie.rodzaj === 'zablokuj_mechanika'
            ? `${pytanie.mechanik.imie} straci dostep natychmiast. Wszystkie jego stanowiska `
              + 'skasuja dane warsztatu przy najblizszym polaczeniu z internetem. '
              + 'Dostep mozna pozniej przywrocic.'
            : `Stanowisko ${pytanie.urzadzenie.nazwa ?? ''} zostanie odciete na stale i skasuje `
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
                'Stanowisko wyrejestrowane.');
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
  oczekujaceOpis: { flex: 1, minWidth: 0 },
  oczekujaceImie: {
    fontSize: s(16), fontWeight: '800', color: Kolory.tekst, marginBottom: 2,
  },
  zatwierdz: {
    backgroundColor: Kolory.akcent,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: Odstepy.l,
    justifyContent: 'center',
    minHeight: CEL_DOTYKU,
  },
  zatwierdzNieaktywny: { opacity: 0.5 },
  zatwierdzTekst: { fontSize: s(14), fontWeight: '800', color: Kolory.tekstNaAkcencie },

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
