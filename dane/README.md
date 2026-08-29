# Katalog `dane` — stara baza lokalna

Ten katalog pochodzi z **poprzedniej wersji** systemu, w której serwer i baza
SQLite stały na komputerze w warsztacie.

Nowa wersja trzyma dane w Supabase, a telefony mają własne kopie robocze.
Ten katalog jest tu **wyłącznie po to, żeby jednorazowo przenieść dane**:

```bash
cd backend
npm run migruj                  # podgląd: ile klientów i wizyt zostanie przeniesione
npm run migruj -- --zapisz      # faktyczny przenos
```

## Co się przeniesie, a co nie

| | |
|---|---|
| `warsztat.db` → klienci i wizyty | ✅ przenoszone |
| `pliki/` → zdjęcia i załączniki | ❌ **nie** — nowy system nie przechowuje zdjęć |

Skrypt **nie rusza** starej bazy — po migracji plik `warsztat.db` leży dalej
tutaj. Zachowaj go, dopóki nie sprawdzisz, że wszystko jest w chmurze.

## Zdjęcia z `dane/pliki`

Fotografie aut to dane osobowe: zawierają tablice rejestracyjne, często
przypadkowe osoby w tle, a w metadanych EXIF współrzędne GPS i identyfikator
urządzenia. Trzymanie ich „na wszelki wypadek”, poza jakąkolwiek ewidencją,
jest ryzykiem bez korzyści.

**Zalecenie:** po sprawdzeniu, że nie są do niczego potrzebne — skasuj je.
Jeśli któreś są dowodem w toczącym się sporze, przenieś je do osobnego,
opisanego katalogu i wpisz tę czynność do rejestru czynności przetwarzania
(`rodo/rejestr-czynnosci.md`).

Cały ten katalog jest wykluczony z repozytorium przez `.gitignore`.
