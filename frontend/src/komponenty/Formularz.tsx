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

/**
 * Oko "pokaz haslo" narysowane samymi widokami.
 *
 * Swiadomie bez biblioteki ikon: caly projekt nie ma ani jednej, a dokladanie
 * kilku megabajtow fontow do paczki programu dla jednego znaczka byloby zla
 * wymiana. Ksztalt jest ten sam w programie i w przegladarce.
 */
function IkonaOka({ przekreslone }: { przekreslone: boolean }) {
  return (
    <View style={style.oko}>
      <View style={style.okoRamka}>
        <View style={style.okoZrenica} />
      </View>
      {przekreslone ? <View style={style.okoPrzekreslenie} /> : null}
    </View>
  );
}

export function Pole({
  etykieta, wymagane, style: styl, secureTextEntry, ...reszta
}: PoleProps) {
  // Kazde pole hasla dostaje podglad. Wpisywanie w ciemno tego samego hasla
  // dwa razy to najczestszy powod "nie moge sie zalogowac".
  const [pokazHaslo, setPokazHaslo] = React.useState(false);
  const zHaslem = !!secureTextEntry;

  return (
    <View style={style.pole}>
      <Text style={style.etykieta}>
        {etykieta}
        {wymagane ? <Text style={style.gwiazdka}> *</Text> : null}
      </Text>

      <View style={zHaslem ? style.opakowanieHasla : undefined}>
        <TextInput
          placeholderTextColor={Kolory.tekstSlaby}
          secureTextEntry={zHaslem && !pokazHaslo}
          {...reszta}
          style={[
            style.wejscie,
            reszta.multiline && style.wejscieWielolinijkowe,
            zHaslem && style.wejscieZHaslem,
            styl,
          ]}
        />

        {zHaslem ? (
          <Pressable
            onPress={() => setPokazHaslo((w) => !w)}
            accessibilityRole="button"
            accessibilityLabel={pokazHaslo ? 'Ukryj haslo' : 'Pokaz haslo'}
            hitSlop={8}
            style={({ pressed }) => [style.przelacznikHasla, pressed && { opacity: 0.6 }]}
          >
            <IkonaOka przekreslone={!pokazHaslo} />
          </Pressable>
        ) : null}
      </View>
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

  /* --------------------------- pole hasla ----------------------------- */
  opakowanieHasla: { justifyContent: 'center' },
  // Miejsce po prawej na oko - tekst hasla nie moze pod nie wjechac.
  wejscieZHaslem: { paddingRight: s(48) },
  przelacznikHasla: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: s(46),
    alignItems: 'center',
    justifyContent: 'center',
  },
  oko: { width: s(24), height: s(24), alignItems: 'center', justifyContent: 'center' },
  okoRamka: {
    width: s(22),
    height: s(13),
    borderWidth: s(1.7),
    borderColor: Kolory.tekstSlaby,
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  okoZrenica: {
    width: s(6),
    height: s(6),
    borderRadius: s(3),
    backgroundColor: Kolory.tekstSlaby,
  },
  okoPrzekreslenie: {
    position: 'absolute',
    width: s(26),
    height: s(1.7),
    borderRadius: s(1),
    backgroundColor: Kolory.tekstSlaby,
    transform: [{ rotate: '-45deg' }],
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
