# Przepływy — co się dzieje krok po kroku

## 1. Pierwszy warsztat (kod zaproszenia)

```
dostawca:    utworz_zaproszenie(...)          → kod, np. 8 znaków
mechanik:    parowanie { akcja: "zglos" }     → id + kod + sekret
mechanik:    parowanie { "aktywuj_zaproszenie", id, sekret, kod }
                ↓ aktywuj_zaproszenie() w bazie
                • zakłada warsztat (nazwa, prefiks, nastawy domyślne)
                • zakłada konto z rolą administrator
                • przypina urządzenie do warsztatu i mechanika
program:     parowanie { "sprawdz", id, sekret } → token urządzenia
program:     ekran „Ustaw swoje hasło"
```

## 2. Kolejne stanowisko (jeden klik administratora)

```
mechanik:       wpisuje imię i nazwisko → parowanie { "zglos" }
                program pokazuje KOD, odpytuje co 5 s { "sprawdz" }
administrator:  ekran „Dostęp" → admin { "dane" } (odświeżane co 15 s)
                widzi wiersz: imię + kod + nazwa komputera
                klika Zatwierdź → admin { "zatwierdz", kod }
                    ↓ admin_zatwierdz_urzadzenie()
                    • konto mechanika powstaje z imie_zgloszone
                    • urządzenie dostaje mechanik_id i przyznany_o
program:        najbliższe { "sprawdz" } → token, kod i sekret giną z bazy
                → ekran „Ustaw swoje hasło"
```

Kod nie jest sekretem: jego znajomość nic nie daje, bo dostęp przyznaje
administrator, a token odbiera wyłącznie ten, kto ma **sekret**.

## 3. Synchronizacja

Program pracuje **wyłącznie na lokalnej bazie**. Wysyłka i pobranie chodzą
w tle i nigdy nie blokują ekranu.

**Zapis → kolejka → wysyłka**

```
ekran → repozytorium.ts → SQLite (zapis natychmiastowy, oczekuje = 1)
                        → kolejka (trwała, przeżywa restart)
        synchronizacja.ts → sync { akcja: "push", zmiany: [...] }  (paczki ≤ 200)
                          → wyniki: ok / kwarantanna / odmowa / scalone
                          → pozycje z wynikiem znikają z kolejki, oczekuje = 0
```

Kolejka **nigdy nie zatrzymuje się na jednej pozycji**: nawet zapis
niemożliwy do wykonania wraca jako „przyjęty do kwarantanny".

**Pobranie**

```
sync { akcja: "pull", kursory }
   → klienci + wizyty z okna (90 dni + wszystko otwarte)
   → zapis do SQLite z jednym wyjątkiem: rekordy z oczekuje = 1 nie są
     nadpisywane, żeby świeżo wpisany tekst nie migał na ekranie
   → jeśli wiecej = true, pull powtarza się z nowym kursorem
```

**Kiedy:** natychmiast po każdym zapisie, cyklicznie co 45 s (także przy
zablokowanym ekranie — dzięki temu polecenie „wyczyść" dociera do
stanowiska, którego nikt nie odblokowuje) i natychmiast po powrocie
internetu.

## 4. Polecenia zdalne

Wynik `uwierzytelnij_urzadzenie()` niesie flagi, które program czyta przy
każdym kontakcie:

| Flaga / kod | Reakcja programu |
|---|---|
| `403 WYCZYSC` | kasuje token, hasło i **całą lokalną bazę**, wraca do ekranu parowania |
| `403 ZABLOKOWANE` | pokazuje powód, dane zostają (administrator może cofnąć blokadę) |
| `401 NIEZNANY_TOKEN` | sesja unieważniona na stałe — czyszczenie i parowanie od nowa |
| `polecenia.reset_hasla` | prosi o ustawienie nowego hasła, dane zostają |

Do tego działa **auto-wipe bez udziału serwera**: jeśli program nie połączył
się przez `wygasniecie_offline_dni` (domyślnie 14), kasuje swoją bazę sam.
Skradziony komputer nigdy się nie połączy, więc wyczyści się sam.

## 5. Usuwanie wizyty i karencja

```
mechanik: „Usuń zgłoszenie"
   program: ocenUsuwanieWizyty() — liczy lokalnie, żeby działać bez sieci
            (wolno tylko dla „naprawione", po 30 dniach od naprawione_o)
   push { operacja: "usun" }
      ↓ zapisz_z_telefonu() → mozna_usunac_wizyte()
        • wolno   → usuniete_o = now()
        • nie wolno → status: "odmowa" + powód (NIE kwarantanna)
   program: pokazuje pasek z powodem i przywraca wizytę u siebie
```

Fizyczne kasowanie następuje dopiero w `zadanie_retencji()`, po
`retencja_dni` (domyślnie rok) od oznaczenia jako usunięte.

## 6. Duplikaty kartotek (B3)

Dwa niezależne mechanizmy, bo praca offline nie ma jak sprawdzić bazy:

1. **na komputerze** — formularz nowego klienta na żywo porównuje numer
   (9 ostatnich cyfr) z lokalną bazą i ostrzega **zanim** powstanie druga
   kartoteka; profil klienta proponuje scalenie,
2. **na serwerze** — `zapisz_z_telefonu()` po wstawieniu klienta szuka
   podobnego po `telefon_norm` / `nazwa_norm` i odkłada podejrzenie do
   `mozliwe_duplikaty`.

Scalenie (`operacja: "scal"`) przepina wizyty i oznacza kartotekę źródłową
jako `scalony_z` — nic nie znika bezpowrotnie.

## 7. Numery zleceń

```
komputer:  numer_roboczy  „W-2026-0001"  — nadany od razu, także offline
serwer:    numer_oficjalny „WK/2026/0001" — przy pierwszym udanym zapisie,
                                            z licznika numeratory
```

Dwa warsztaty pracujące bez sieci nie wygenerują tego samego numeru
oficjalnego, bo żaden komputer go nie nadaje.

## 8. Retencja (codziennie 3:17)

`pg_cron` → `zadanie_retencji()` → fizyczne kasowanie: wizyty i klienci po
`retencja_dni`, klucze idempotencji po 30 dniach, rozwiązana kwarantanna po
90 dniach, dziennik dostępu po 12 miesiącach, dziennik administratora po
24 miesiącach, martwe zgłoszenia parowania i wygasłe liczniki tempa.

Program stosuje **tę samą regułę u siebie**: `posprzatajPozaOknem()` kasuje
lokalnie zamknięte wizyty spoza okna `okno_dni`, o ile nic nie czeka w kolejce.
