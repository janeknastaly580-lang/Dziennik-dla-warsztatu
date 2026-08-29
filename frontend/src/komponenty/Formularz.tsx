/** Wspolne elementy formularzy: pola, wybor opcji, przyciski. */
import React from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View,
} from 'react-native';

import { Kolory, Odstepy, Zaokraglenia } from '../motyw';
import { CEL_DOTYKU, s } from '../uklad';

export function Sekcja({ tytul, children }: { tytul: string; children: React.ReactNode }) {
  return (
    <View style={style.sekcja}>
      <Text style={style.sekcjaTytul}>{tytul}</Text>
      {children}
    </View>
  );
}

type PoleProps = TextInputProps & {
  etykieta: string;
  wymagane?: boolean;
};

export function Pole({ etykieta, wymagane, style: styl, ...reszta }: PoleProps) {
  return (
    <View style={style.pole}>
      <Text style={style.etykieta}>
        {etykieta}
        {wymagane ? <Text style={style.gwiazdka}> *</Text> : null}
      </Text>
      <TextInput
        placeholderTextColor={Kolory.tekstSlaby}
        {...reszta}
        style={[
          style.wejscie,
          reszta.multiline && style.wejscieWielolinijkowe,
          styl,
        ]}
      />
    </View>
  );
}

export function WyborOpcji<T extends string | number>({
  etykieta,
  opcje,
  wybrana,
  onWybor,
}: {
  etykieta: string;
  opcje: { wartosc: T; etykieta: string; kolor?: string }[];
  wybrana: T;
  onWybor: (wartosc: T) => void;
}) {
  return (
    <View style={style.pole}>
      <Text style={style.etykieta}>{etykieta}</Text>
      <View style={style.opcje}>
        {opcje.map((o) => {
          const aktywna = o.wartosc === wybrana;
          const kolor = o.kolor ?? Kolory.akcent;
          return (
            <Pressable
              key={String(o.wartosc)}
              onPress={() => onWybor(o.wartosc)}
              style={[
                style.opcja,
                aktywna && { backgroundColor: kolor, borderColor: kolor },
              ]}
            >
              <Text style={[style.opcjaTekst, aktywna && style.opcjaTekstAktywny]}>
                {o.etykieta}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Przycisk({
  tytul,
  onPress,
  wariant = 'glowny',
  zajety,
  wylaczony,
}: {
  tytul: string;
  onPress: () => void;
  wariant?: 'glowny' | 'drugi' | 'niebezpieczny';
  zajety?: boolean;
  wylaczony?: boolean;
}) {
  const nieaktywny = zajety || wylaczony;
  return (
    <Pressable
      onPress={onPress}
      disabled={nieaktywny}
      style={({ pressed }) => [
        style.przycisk,
        wariant === 'glowny' && style.przyciskGlowny,
        wariant === 'drugi' && style.przyciskDrugi,
        wariant === 'niebezpieczny' && style.przyciskNiebezpieczny,
        pressed && !nieaktywny && style.przyciskWcisniety,
        nieaktywny && style.przyciskNieaktywny,
      ]}
    >
      {zajety ? (
        <ActivityIndicator
          color={wariant === 'drugi' ? Kolory.akcent : Kolory.tekstNaAkcencie}
        />
      ) : (
        <Text
          style={[
            style.przyciskTekst,
            wariant === 'drugi' && style.przyciskTekstDrugi,
          ]}
        >
          {tytul}
        </Text>
      )}
    </Pressable>
  );
}

export function KomunikatFormularza({ tresc }: { tresc?: string | null }) {
  if (!tresc) return null;
  return (
    <View style={style.komunikat}>
      <Text style={style.komunikatTekst}>{tresc}</Text>
    </View>
  );
}

const style = StyleSheet.create({
  sekcja: {
    backgroundColor: Kolory.powierzchnia,
    borderRadius: Zaokraglenia.l,
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    padding: Odstepy.l,
    marginBottom: Odstepy.m,
  },
  sekcjaTytul: {
    fontSize: s(12),
    fontWeight: '800',
    letterSpacing: 0.7,
    color: Kolory.tekstSlaby,
    marginBottom: Odstepy.m,
  },
  pole: { marginBottom: Odstepy.m },
  etykieta: {
    fontSize: s(13),
    fontWeight: '600',
    color: Kolory.tekstDrugi,
    marginBottom: s(6),
  },
  gwiazdka: { color: Kolory.pilne },
  wejscie: {
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    backgroundColor: Kolory.powierzchniaStonowana,
    borderRadius: Zaokraglenia.m,
    paddingHorizontal: Odstepy.m,
    paddingVertical: s(12),
    fontSize: s(16),
    color: Kolory.tekst,
    minHeight: CEL_DOTYKU,
  },
  wejscieWielolinijkowe: {
    minHeight: s(96),
    textAlignVertical: 'top',
    paddingTop: Odstepy.m,
  },
  opcje: { flexDirection: 'row', flexWrap: 'wrap', gap: Odstepy.s },
  opcja: {
    borderWidth: 1,
    borderColor: Kolory.obramowanie,
    backgroundColor: Kolory.powierzchniaStonowana,
    borderRadius: Zaokraglenia.pelne,
    paddingVertical: s(11),
    paddingHorizontal: Odstepy.l,
    minHeight: CEL_DOTYKU,
    justifyContent: 'center',
  },
  opcjaTekst: { fontSize: s(14), fontWeight: '700', color: Kolory.tekstDrugi },
  opcjaTekstAktywny: { color: Kolory.tekstNaAkcencie },
  przycisk: {
    borderRadius: Zaokraglenia.m,
    paddingVertical: s(15),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CEL_DOTYKU + s(8),
  },
  przyciskGlowny: { backgroundColor: Kolory.akcent },
  przyciskDrugi: {
    backgroundColor: Kolory.powierzchnia,
    borderWidth: 1,
    borderColor: Kolory.obramowanieMocne,
  },
  przyciskNiebezpieczny: { backgroundColor: Kolory.pilne },
  przyciskWcisniety: { opacity: 0.85 },
  przyciskNieaktywny: { opacity: 0.6 },
  przyciskTekst: { fontSize: s(16), fontWeight: '800', color: Kolory.tekstNaAkcencie },
  przyciskTekstDrugi: { color: Kolory.tekstDrugi },
  komunikat: {
    backgroundColor: Kolory.bladTlo,
    borderWidth: 1,
    borderColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  komunikatTekst: { color: Kolory.blad, fontSize: s(14), lineHeight: s(19) },
});
