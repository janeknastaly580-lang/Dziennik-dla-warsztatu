/**
 * Ekran "Aplikacja i synchronizacja".
 *
 * Nie ma tu adresu serwera do wpisywania - aplikacja laczy sie z chmura
 * warsztatu, a dostep przyznaje administrator.
 *
 * SYNCHRONIZACJA JEST NIEWIDOCZNA. Na ekranach roboczych nie ma po niej ani
 * sladu: dziala sama, po kazdym zapisie i cyklicznie w tle. Jedyne jej
 * miejsce w interfejsie to maly znacznik u gory TEGO ekranu - kropka
 * z liczba pozycji, ktore czekaja jeszcze na wyslanie. Dotkniecie wysyla
 * je natychmiast.
 *
 * Poza tym mechanik widzi tu:
 *  A4  po ilu dniach bez polaczenia program sam skasuje swoje dane,
 *  A10 informacje, ze wgladu w kartoteki sa zapisywane.
 *
 * Nie ma i nie bedzie funkcji "eksportuj wszystko do pliku" (A10) - nic tak
 * nie ulatwia wyniesienia calej bazy klientow jak jeden przycisk.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Przycisk, Sekcja } from '../komponenty/Formularz';
import { pobierzMeta } from '../dane/baza';
import { liczbaWKolejce } from '../dane/kolejka';
import { pobierzIdUrzadzenia } from '../dane/sesja';
import { useAplikacja } from '../dane/kontekst';
import { WERSJA_APLIKACJI, WERSJA_SCHEMATU } from '../dane/konfiguracja';
import { Kolory, Odstepy, Zaokraglenia } from '../motyw';
import { SZEROKOSC_CZYTANIA, s, wys } from '../uklad';

export default function EkranUstawien() {
  const router = useRouter();
  const {
    sync, mechanik, warsztat, rola, czyAdministrator, synchronizuj, zablokuj,
  } = useAplikacja();

  const [urzadzenie, setUrzadzenie] = useState<string | null>(null);
  const [okno, setOkno] = useState<string | null>(null);
  const [wygasniecie, setWygasniecie] = useState<string | null>(null);
  const [wKolejce, setWKolejce] = useState(0);

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

  return (
    <ScrollView style={style.ekran} contentContainerStyle={style.tresc}>
      <ZnacznikSynchronizacji
        wKolejce={wKolejce}
        trwa={sync.trwa}
        onDotkniecie={wymusSynchronizacje}
      />

      {/* B10: jedyny stan synchronizacji, ktory mechanik MUSI zobaczyc, bo
          sam go nie naprawi - aplikacja jest za stara, zeby pobierac dane. */}
      {sync.wymagaAktualizacji ? (
        <View style={style.doAktualizacji}>
          <Text style={style.doAktualizacjiTekst}>
            Ta wersja aplikacji jest za stara, zeby pobierac nowe dane. Twoje zapisy
            nadal ida na serwer i nic nie ginie, ale zglos to administratorowi -
            trzeba zainstalowac nowsza wersje.
          </Text>
        </View>
      ) : null}

      <Sekcja tytul="TO URZADZENIE">
        <Wiersz etykieta="Mechanik" wartosc={mechanik ?? '-'} />
        <Wiersz etykieta="Warsztat" wartosc={warsztat ?? '-'} />
        <Wiersz
          etykieta="Uprawnienia"
          wartosc={czyAdministrator ? 'administrator warsztatu' : rola}
        />
        <Wiersz etykieta="Wersja aplikacji" wartosc={WERSJA_APLIKACJI} />
        <Wiersz etykieta="Wersja danych" wartosc={String(WERSJA_SCHEMATU)} />
        <Wiersz
          etykieta="Historia na komputerze"
          wartosc={`${okno ?? '90'} dni + wszystko otwarte`}
        />
        <Wiersz
          etykieta="Numer urzadzenia"
          wartosc={urzadzenie ? `${urzadzenie.slice(0, 8)}...` : '-'}
        />
        <Text style={style.podpowiedz}>
          Podaj numer urzadzenia administratorowi, jesli prosi o identyfikacje stanowiska.
        </Text>
      </Sekcja>

      {czyAdministrator ? (
        <Sekcja tytul="ZARZADZANIE DOSTEPEM">
          <Text style={style.podpowiedz}>
            Jako administrator warsztatu mozesz przyznac dostep komputerowi
            mechanika - zdalnie, jednorazowym kodem z jego ekranu, bez podawania
            zadnego hasla - oraz odebrac dostep, gdy ktos odchodzi. Poza tym
            widzisz dokladnie to samo co kazdy mechanik.
          </Text>
          <Przycisk
            tytul="Otworz zarzadzanie dostepem"
            onPress={() => router.push('/administracja')}
          />
        </Sekcja>
      ) : null}

      <Sekcja tytul="BEZPIECZENSTWO">
        <View style={style.informacja}>
          <Text style={style.informacjaTekst}>
            Haslo podajesz raz - przy uruchomieniu programu. Przelaczenie sie na
            inne okno nie zamyka dostepu; blokada wraca dopiero po zamknieciu
            i ponownym otwarciu programu. Kiedy odchodzisz od komputera,
            zablokuj aplikacje przyciskiem ponizej.
          </Text>
          <Text style={style.informacjaTekst}>
            Jesli ten komputer nie polaczy sie z serwerem przez {wygasniecie ?? '14'} dni,
            skasuje dane warsztatu ze swojego dysku. To zabezpieczenie na wypadek
            kradziezy - skradziony komputer czysci sie sam.
          </Text>
          <Text style={style.informacjaTekst}>
            Otwarcia kartotek klientow sa zapisywane w dzienniku dostepu warsztatu.
          </Text>
          <Text style={style.informacjaTekst}>
            Aplikacja nie robi ani nie przechowuje zdjec. Opis usterki wpisuj tekstem.
          </Text>
        </View>

        <Przycisk tytul="Zablokuj aplikacje teraz" wariant="drugi" onPress={zablokuj} />
      </Sekcja>
    </ScrollView>
  );
}

/**
 * Caly interfejs synchronizacji: kropka i liczba.
 *
 * Zero to zielony ptaszek, cokolwiek wiecej - pomaranczowa liczba pozycji,
 * ktore czekaja na wyslanie. Nie ma tu slowa "synchronizacja", bo mechanika
 * nie interesuje mechanizm, tylko to, czy cos jeszcze wisi. Dotkniecie
 * probuje wyslac natychmiast (przydatne, gdy wlasnie wrocil zasieg).
 */
function ZnacznikSynchronizacji({ wKolejce, trwa, onDotkniecie }: {
  wKolejce: number; trwa: boolean; onDotkniecie: () => void;
}) {
  const czysto = wKolejce === 0;
  const kolor = czysto ? Kolory.ok : Kolory.wTrakcie;

  return (
    <View style={style.paskiem}>
      <Pressable
        onPress={onDotkniecie}
        disabled={trwa}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={czysto
          ? 'Wszystko wyslane na serwer'
          : `${wKolejce} zmian czeka na wyslanie. Dotknij, zeby wyslac teraz.`}
        style={({ pressed }) => [
          style.znacznik,
          { borderColor: kolor },
          pressed && { opacity: 0.6 },
        ]}
      >
        <View style={[style.znacznikKropka, { backgroundColor: kolor }]} />
        <Text style={[style.znacznikTekst, { color: kolor }]}>
          {trwa ? '···' : czysto ? '✓' : wKolejce}
        </Text>
      </Pressable>
    </View>
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
  tresc: {
    padding: Odstepy.l,
    paddingBottom: wys(8, 32),
    width: '100%',
    maxWidth: SZEROKOSC_CZYTANIA,
    alignSelf: 'center',
  },

  paskiem: { alignItems: 'flex-end', marginBottom: Odstepy.s },
  znacznik: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    borderWidth: 1,
    borderRadius: Zaokraglenia.pelne,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
  },
  znacznikKropka: { width: s(6), height: s(6), borderRadius: 999 },
  znacznikTekst: { fontSize: s(11), fontWeight: '800' },
  doAktualizacji: {
    backgroundColor: Kolory.pilneTlo,
    borderWidth: 1,
    borderColor: Kolory.pilneObramowanie,
    borderRadius: Zaokraglenia.m,
    padding: Odstepy.m,
    marginBottom: Odstepy.m,
  },
  doAktualizacjiTekst: { fontSize: s(12.5), lineHeight: s(18), color: Kolory.blad },
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
