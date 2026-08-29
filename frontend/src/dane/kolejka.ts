/**
 * Kolejka zmian czekajacych na wyslanie.
 *
 * B8 - to jest miejsce, w ktorym najlatwiej cicho stracic prace mechanika.
 *      Zasady, ktore tego pilnuja:
 *        * kolejka jest w SQLite, wiec przezywa restart, crash i wylaczenie
 *          telefonu,
 *        * kazda pozycja albo zostaje przyjeta przez serwer, albo ladzie
 *          w jego kwarantannie - w obu wypadkach znika z kolejki, wiec
 *          nastepne pozycje nigdy nie stoja za jedna zepsuta,
 *        * z kolejki NIC nie znika z powodu bledu sieci.
 *
 * B1 - zapisujemy tylko kolumny faktycznie zmienione. Mechanik, ktory
 *      poprawil opis, nie cofnie statusu ustawionego przez kolege.
 *
 * B12 - `id` pozycji kolejki jest kluczem idempotencji wysylanym na serwer.
 *       Ponowienie po nieudanej wysylce nie tworzy drugiego rekordu.
 *
 * D5 - kolumna `oczekuje` w tabelach danych zapala zegarek przy kafelku.
 */
import { baza } from './baza';

export type Operacja = 'wstaw' | 'zmien' | 'usun' | 'scal';
export type TabelaSync = 'klienci' | 'wizyty' | 'dziennik_dostepu';

export type PozycjaKolejki = {
  id: number;
  tabela: TabelaSync;
  rekord_id: string;
  operacja: Operacja;
  pola: string;
  zrobione_o: string;
  proby: number;
  ostatni_blad: string | null;
};

/** Dokłada zmiane na koniec kolejki i zapala znacznik "czeka na wyslanie". */
export async function dodajDoKolejki(
  tabela: TabelaSync,
  rekordId: string,
  operacja: Operacja,
  pola: Record<string, unknown>,
  zrobioneO: string = new Date().toISOString(),
): Promise<void> {
  const db = await baza();
  await db.runAsync(
    'INSERT INTO kolejka (tabela, rekord_id, operacja, pola, zrobione_o, utworzono)' +
    ' VALUES (?, ?, ?, ?, ?, ?)',
    tabela, rekordId, operacja, JSON.stringify(pola), zrobioneO, new Date().toISOString(),
  );
  if (tabela === 'klienci' || tabela === 'wizyty') {
    await db.runAsync(`UPDATE ${tabela} SET oczekuje = 1 WHERE id = ?`, rekordId);
  }
}

export async function pobierzPaczke(ile: number): Promise<PozycjaKolejki[]> {
  const db = await baza();
  return db.getAllAsync<PozycjaKolejki>(
    'SELECT * FROM kolejka ORDER BY id ASC LIMIT ?', ile,
  );
}

/**
 * Usuwa przyjete pozycje i gasi znacznik "czeka" tam, gdzie juz nic
 * nie zostalo w kolejce.
 */
export async function usunZKolejki(idy: number[]): Promise<void> {
  if (!idy.length) return;
  const db = await baza();
  const znaki = idy.map(() => '?').join(',');

  const dotkniete = await db.getAllAsync<{ tabela: string; rekord_id: string }>(
    `SELECT DISTINCT tabela, rekord_id FROM kolejka WHERE id IN (${znaki})`, ...idy,
  );
  await db.runAsync(`DELETE FROM kolejka WHERE id IN (${znaki})`, ...idy);

  for (const { tabela, rekord_id } of dotkniete) {
    if (tabela !== 'klienci' && tabela !== 'wizyty') continue;
    const zostalo = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM kolejka WHERE tabela = ? AND rekord_id = ?',
      tabela, rekord_id,
    );
    if ((zostalo?.n ?? 0) === 0) {
      await db.runAsync(`UPDATE ${tabela} SET oczekuje = 0 WHERE id = ?`, rekord_id);
    }
  }
}

/** Blad sieci - pozycja ZOSTAJE w kolejce, notujemy tylko probe. */
export async function zanotujNieudanaProbe(idy: number[], blad: string): Promise<void> {
  if (!idy.length) return;
  const db = await baza();
  const znaki = idy.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE kolejka SET proby = proby + 1, ostatni_blad = ? WHERE id IN (${znaki})`,
    blad.slice(0, 300), ...idy,
  );
}

export async function liczbaWKolejce(): Promise<number> {
  const db = await baza();
  const w = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM kolejka');
  return w?.n ?? 0;
}

/** D5: najstarsza pozycja - jesli czeka dluzej niz dobe, cos jest nie tak. */
export async function najstarszaPozycja(): Promise<string | null> {
  const db = await baza();
  const w = await db.getFirstAsync<{ utworzono: string }>(
    'SELECT utworzono FROM kolejka ORDER BY id ASC LIMIT 1',
  );
  return w?.utworzono ?? null;
}
