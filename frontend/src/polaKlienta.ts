/**
 * Pola kartoteki klienta - jedna definicja dla obu formularzy.
 *
 * Wczesniej ekran "Nowy klient" mial szesc recznie wypisanych pol, a ekran
 * edycji wlasna tablice z tymi samymi etykietami. Zmiana etykiety w jednym
 * miejscu nie doganiala drugiego; teraz nie ma czego rozjechac.
 *
 * `placeholder` widac tylko w pustym formularzu nowego klienta - przy edycji
 * pola i tak maja wartosci.
 */
export const POLA_KLIENTA = [
  {
    klucz: 'nazwa',
    etykieta: 'Imie i nazwisko / nazwa firmy',
    placeholder: 'np. Jan Kowalski',
    wymagane: true,
  },
  {
    klucz: 'telefon',
    etykieta: 'Telefon',
    placeholder: 'np. 601 234 567',
    klawiatura: 'phone-pad',
  },
  {
    klucz: 'email',
    etykieta: 'E-mail',
    placeholder: 'np. jan@example.com',
    klawiatura: 'email-address',
    bezWielkichLiter: true,
  },
  {
    klucz: 'adres',
    etykieta: 'Adres',
    placeholder: 'ulica, kod, miasto',
  },
  {
    klucz: 'nip',
    etykieta: 'NIP (firma)',
    klawiatura: 'number-pad',
  },
  {
    klucz: 'notatki',
    etykieta: 'Notatki',
    placeholder: 'np. faktura 14 dni, kontakt po 16:00',
    wiele: true,
  },
] as const;

export type PoleKlienta = (typeof POLA_KLIENTA)[number];
export type KluczKlienta = PoleKlienta['klucz'];
export type WartosciKlienta = Record<KluczKlienta, string>;

export const PUSTY_KLIENT: WartosciKlienta = {
  nazwa: '', telefon: '', email: '', adres: '', nip: '', notatki: '',
};
