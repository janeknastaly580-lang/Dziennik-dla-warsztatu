/**
 * Typy danych aplikacji.
 *
 * Identyfikatory sa tekstowymi UUID nadawanymi na telefonie (B5, B12) -
 * ten sam identyfikator jedzie na serwer przy kazdym ponowieniu wysylki,
 * wiec zaden zapis nie zdubluje sie w bazie.
 *
 * Nie ma tu typu "Plik". System swiadomie nie przechowuje zdjec ani
 * zalacznikow - ani na telefonie, ani w chmurze.
 */

export type Status = 'nienaprawione' | 'w_trakcie' | 'naprawione';
export type Priorytet = 'niski' | 'normalny' | 'wysoki';

/** D5: 1 = rekord ma zmiany, ktore czekaja jeszcze na wyslanie. */
export type Oczekuje = 0 | 1;

/** Pozycja listy na ekranie glownym. */
export type KlientNaLiscie = {
  id: string;
  nazwa: string;
  telefon: string | null;
  email: string | null;
  adres: string | null;
  liczba_wizyt: number;
  liczba_otwartych: number;
  liczba_aut: number;
  /** Sklejone unikalne opisy aut z wizyt tego klienta. */
  auta: string | null;
  ostatnia_wizyta: string | null;
  oczekuje: Oczekuje;
};

/**
 * Auto NIE jest osobnym rekordem - to swobodny tekst wpisany przy wizycie.
 * Zakladki w profilu powstaja z grupowania po tym tekscie.
 */
export type Auto = {
  auto: string;
  liczba_wizyt: number;
  liczba_otwartych: number;
};

export type Klient = {
  id: string;
  nazwa: string;
  telefon: string | null;
  email: string | null;
  adres: string | null;
  nip: string | null;
  notatki: string | null;
  zrobione_o: string | null;
  zapisane_o: string | null;
  usuniete_o: string | null;
  oczekuje: Oczekuje;
  auta: Auto[];
  statystyki: {
    wizyty_razem: number;
    otwarte: number;
    naprawione: number;
    koszt_razem: number;
  };
};

export type Wizyta = {
  id: string;
  klient_id: string;
  /** Swobodny opis auta: marka, model, rejestracja - albo cokolwiek innego. */
  auto: string | null;
  tytul: string;
  opis: string | null;
  status: Status;
  priorytet: Priorytet;
  data_wizyty: string;
  /** Godzina rozpoczecia w kalendarzu ('HH:MM'); null = termin nieustawiony. */
  godzina_od: string | null;
  /** Godzina zakonczenia w kalendarzu ('HH:MM'). */
  godzina_do: string | null;
  data_zamkniecia: string | null;
  /** Moment oznaczenia jako naprawione - od niego liczy sie karencja usuwania. */
  naprawione_o: string | null;
  przebieg: number | null;
  koszt: number | null;
  /** B5: numer nadany na telefonie (widoczny od razu). */
  numer_roboczy: string | null;
  /** B5: numer nadany przez serwer przy synchronizacji. */
  numer_oficjalny: string | null;
  zrobione_o: string | null;
  zapisane_o: string | null;
  usuniete_o: string | null;
  oczekuje: Oczekuje;
  // pola dolaczane przez JOIN
  klient_nazwa?: string;
  klient_telefon?: string | null;
};
