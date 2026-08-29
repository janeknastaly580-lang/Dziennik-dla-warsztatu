/**
 * Pasek stanu synchronizacji - stale widoczny nad kazda lista.
 *
 * D4 - Mechanik ma widziec WIEK DANYCH bez szukania. "Zsynchronizowano 14:32"
 *      albo wyrazne "brak polaczenia", zeby nie podejmowal decyzji na
 *      nieaktualnych danych, nie wiedzac o tym.
 * D5 - Licznik "N czeka na wyslanie" plus ostrzezenie, gdy najstarsza pozycja
 *      wisi dluzej niz dobe. Niepewnosc, czy zapis dotarl, konczy sie
 *      wpisaniem tego samego drugi raz - czyli duplikatem (B3).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAplikacja } from '../dane/kontekst';
import { Kolory, Odstepy, Zaokraglenia } from '../motyw';
import { s } from '../uklad';

function wiekDanych(iso: string | null): { tekst: string; stary: boolean } {
  if (!iso) return { tekst: 'jeszcze nie zsynchronizowano', stary: true };

  const minut = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minut < 2) return { tekst: 'dane aktualne', stary: false };
  if (minut < 60) return { tekst: `dane sprzed ${minut} min`, stary: minut > 30 };

  const godzin = Math.floor(minut / 60);
  if (godzin < 24) return { tekst: `dane sprzed ${godzin} h`, stary: true };
  return { tekst: `dane sprzed ${Math.floor(godzin / 24)} dni`, stary: true };
}

export default function PasekSynchronizacji() {
  const { sync, synchronizuj } = useAplikacja();
  const wiek = wiekDanych(sync.ostatniaUdana);

  const czekaDlugo = sync.najstarszaCzeka
    && Date.now() - new Date(sync.najstarszaCzeka).getTime() > 24 * 3600 * 1000;

  const kolor = sync.odciecie || czekaDlugo
    ? Kolory.pilne
    : wiek.stary || sync.blad ? Kolory.wTrakcie : Kolory.ok;

  const tlo = sync.odciecie || czekaDlugo
    ? Kolory.pilneTlo
    : wiek.stary || sync.blad ? Kolory.wTrakcieTlo : Kolory.okTlo;

  return (
    <Pressable
      onPress={() => synchronizuj({ wymuszona: true })}
      accessibilityRole="button"
      accessibilityLabel="Synchronizuj teraz"
      style={[style.pasek, { backgroundColor: tlo, borderColor: kolor }]}
    >
      <View style={[style.kropka, { backgroundColor: kolor }]} />

      <Text style={[style.tekst, { color: kolor }]} numberOfLines={1}>
        {sync.trwa ? 'Synchronizacja...' : wiek.tekst}
      </Text>

      {sync.wKolejce > 0 ? (
        <View style={[style.licznik, { borderColor: kolor }]}>
          <Text style={[style.licznikTekst, { color: kolor }]}>
            {'⏱'} {sync.wKolejce} czeka
          </Text>
        </View>
      ) : (
        <Text style={[style.ptaszek, { color: kolor }]}>{'✓'} wyslane</Text>
      )}
    </Pressable>
  );
}

/** Ostrzezenie na cala szerokosc - pokazywane tylko, gdy naprawde trzeba. */
export function OstrzezenieSynchronizacji() {
  const { sync } = useAplikacja();

  const czekaDlugo = sync.najstarszaCzeka
    && Date.now() - new Date(sync.najstarszaCzeka).getTime() > 24 * 3600 * 1000;

  if (sync.wymagaAktualizacji) {
    return (
      <View style={style.ostrzezenie}>
        <Text style={style.ostrzezenieTekst}>
          Ta wersja aplikacji jest za stara, zeby pobierac nowe dane. Twoje zapisy
          nadal sa wysylane i nic nie ginie, ale zaktualizuj aplikacje jak najszybciej.
        </Text>
      </View>
    );
  }

  if (czekaDlugo) {
    return (
      <View style={style.ostrzezenie}>
        <Text style={style.ostrzezenieTekst}>
          Najstarsza zmiana czeka na wyslanie ponad dobe. Sprawdz zasieg, a jesli
          internet dziala - zglos to administratorowi.
        </Text>
      </View>
    );
  }

  return null;
}

const style = StyleSheet.create({
  pasek: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    borderWidth: 1,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: Odstepy.m,
    paddingVertical: s(6),
    marginBottom: Odstepy.s,
  },
  kropka: { width: s(8), height: s(8), borderRadius: 999 },
  tekst: { flex: 1, fontSize: s(12), fontWeight: '700' },
  licznik: {
    borderWidth: 1,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: s(8),
    paddingVertical: 1,
  },
  licznikTekst: { fontSize: s(11), fontWeight: '800' },
  ptaszek: { fontSize: s(11), fontWeight: '700' },
  ostrzezenie: {
    backgroundColor: Kolory.pilneTlo,
    borderWidth: 1,
    borderColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.s,
  },
  ostrzezenieTekst: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.blad },
});
