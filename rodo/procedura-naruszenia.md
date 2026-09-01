# Procedura na wypadek naruszenia ochrony danych

> **Ten dokument ma sens tylko wtedy, gdy jest spisany ZANIM będzie potrzebny.**
> Masz **72 godziny** od stwierdzenia naruszenia na zgłoszenie go do UODO
> (art. 33 RODO). Zegar rusza w chwili, gdy dowiesz się o zdarzeniu —
> nie wtedy, gdy skończysz je analizować.
>
> Uzupełnij `[…]` i wydrukuj. Trzymaj kopię tam, gdzie znajdziesz ją
> bez dostępu do systemu.

---

## Kto co robi

| Rola | Kto | Kontakt |
|---|---|---|
| Osoba decyzyjna (zgłasza do UODO) | `[imię i nazwisko]` | `[tel. / e-mail]` |
| Osoba techniczna (blokuje dostępy, robi kopię) | `[imię i nazwisko]` | `[tel. / e-mail]` |
| Wsparcie prawne | `[kancelaria / brak]` | `[kontakt]` |

**Konto Supabase:** `[e-mail konta]` · projekt `tpigqlvwjatlkhfqtlkt`
**Hasło do panelu administratora:** `[gdzie jest przechowywane]`

---

## Godzina 0 — zatrzymaj krwawienie (pierwsze 60 minut)

Wykonaj **w tej kolejności**. Nie analizuj, dopóki nie zamkniesz dostępu.

1. **Zgubiony lub skradziony komputer** →
   Panel administratora → **Dostęp** → przy mechaniku „Wyrejestruj (zgubiony)”.
   Komputer przy najbliższej próbie połączenia skasuje dane. Jeśli nigdy się nie
   połączy — sam się wyczyści po `[14]` dniach bez synchronizacji.
2. **Podejrzenie, że wyciekł klucz `service_role`** →
   panel Supabase → *Settings → API Keys* → **rotacja klucza**.
   Potem podmień go w `backend/.env` i w sekretach Edge Functions.
   Nie zakładaj, że „raczej nikt nie zauważył”.
3. **Podejrzenie, że ktoś przejął konto Supabase** →
   zmień hasło, włącz/zweryfikuj MFA, wyloguj wszystkie sesje,
   sprawdź listę członków organizacji.
4. **Były pracownik** →
   Panel → **Dostęp** → „Zablokuj dostęp” przy mechaniku.
5. **Zrób kopię dowodów** — zanim cokolwiek zaczniesz naprawiać:
   ```bash
   cd backend && npm run kopia
   ```
   plus zrzuty ekranu z zakładki **Dziennik** (kto co otwierał)
   i z logów Edge Functions w panelu Supabase.

---

## Godziny 1–8 — ustal, co się stało

Wypełnij tabelę. To jest szkielet zgłoszenia do UODO.

| Pytanie | Odpowiedź |
|---|---|
| Kiedy naruszenie nastąpiło? | |
| Kiedy **je stwierdziliśmy**? (start 72 h) | |
| Na czym polegało? (utrata / nieuprawniony dostęp / ujawnienie) | |
| Ile osób dotyczy? (liczba kartotek klientów) | |
| Jakie kategorie danych? (imię, telefon, adres, e‑mail, NIP, opis pojazdu) | |
| Czy były dane szczególnych kategorii? | **Nie** — system ich nie przetwarza |
| Jak duże jest ryzyko dla tych osób? | |
| Co już zrobiliśmy, żeby ograniczyć skutki? | |
| Co zrobimy, żeby się nie powtórzyło? | |

**Skąd wziąć liczby:** panel administratora → zakładka **Dziennik** pokazuje,
które kartoteki były otwierane z danego urządzenia i kiedy. Zakładka **Stan**
pokazuje, ile danych w ogóle miało to urządzenie (okno synchronizacji).

---

## Do 72 godzin — zgłoszenie do UODO

Zgłaszasz, **chyba że** jest mało prawdopodobne, by naruszenie skutkowało
ryzykiem naruszenia praw lub wolności osób. Ocenę i uzasadnienie **zapisz**
niezależnie od decyzji.

- Formularz: <https://uodo.gov.pl/pl/134/233> (zgłoszenie przez ePUAP lub
  formularz elektroniczny).
- Jeśli nie masz jeszcze wszystkich informacji — **zgłoś to, co masz**,
  i uzupełnij później. Spóźnione zgłoszenie jest gorsze niż niepełne.

**Zawiadomienie osób, których dane dotyczą** (art. 34 RODO) — konieczne, gdy
ryzyko jest **wysokie**. Przy wycieku listy klientów warsztatu z telefonami
i adresami zwykle jest. Zawiadomienie musi być napisane prostym językiem
i zawierać: co się stało, jakie dane, co robimy, co osoba może zrobić
sama, oraz kontakt do nas.

---

## Po wszystkim

1. Wpisz zdarzenie do **wewnętrznej ewidencji naruszeń** (art. 33 ust. 5 RODO) —
   prowadzi się ją **także dla naruszeń niezgłoszonych** do UODO.
2. Zapisz wnioski i zmień to, co trzeba zmienić.
3. Odnotuj zmianę w `rejestr-czynnosci.md`.

## Ewidencja naruszeń

| Data stwierdzenia | Opis | Liczba osób | Zgłoszone do UODO? | Osoby zawiadomione? | Wnioski |
|---|---|---|---|---|---|
| | | | | | |
