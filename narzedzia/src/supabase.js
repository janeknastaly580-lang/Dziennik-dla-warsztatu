/**
 * Cienki klient Supabase dla panelu administratora (bez dodatkowych paczek).
 *
 * Wszystkie zapytania ida z kluczem service_role, ktory omija RLS. Dlatego ten
 * modul jest uzywany WYLACZNIE po stronie serwera panelu (A2) i nigdy nie ma
 * prawa trafic do przegladarki ani do aplikacji mobilnej.
 */
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './config.js';

export class BladSupabase extends Error {
  constructor(komunikat, status = 500, szczegoly) {
    super(komunikat);
    this.name = 'BladSupabase';
    this.status = status;
    this.szczegoly = szczegoly;
  }
}

function naglowki(dodatkowe = {}) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new BladSupabase(
      'Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w backend/.env', 500,
    );
  }
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...dodatkowe,
  };
}

async function zadanie(sciezka, opcje = {}) {
  // Brak konfiguracji to inny blad niz brak sieci - liczony osobno, zeby
  // komunikat w panelu mowil prawde.
  const naglowkiZadania = naglowki(opcje.headers);

  let odp;
  try {
    odp = await fetch(`${SUPABASE_URL}${sciezka}`, {
      ...opcje,
      headers: naglowkiZadania,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new BladSupabase(
      `Brak polaczenia z Supabase (${SUPABASE_URL}). ${err?.message ?? ''}`.trim(), 502,
    );
  }

  const typ = odp.headers.get('content-type') || '';
  const dane = typ.includes('json') ? await odp.json().catch(() => null) : await odp.text();

  if (!odp.ok) {
    const opis = (dane && typeof dane === 'object' && (dane.message || dane.error))
      || `HTTP ${odp.status}`;
    throw new BladSupabase(String(opis), odp.status, dane);
  }
  return dane;
}

/** SELECT przez PostgREST. `zapytanie` to gotowy ciag parametrow. */
export function wybierz(tabela, zapytanie = '') {
  const q = zapytanie ? `?${zapytanie}` : '';
  return zadanie(`/rest/v1/${tabela}${q}`, { method: 'GET' });
}

export function wstaw(tabela, wiersz) {
  return zadanie(`/rest/v1/${tabela}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(wiersz),
  });
}

export function zmien(tabela, zapytanie, zmiany) {
  return zadanie(`/rest/v1/${tabela}?${zapytanie}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(zmiany),
  });
}

/** Wywolanie funkcji SQL (wszystkie reguly biznesowe siedza w bazie). */
export function funkcja(nazwa, argumenty = {}) {
  return zadanie(`/rest/v1/rpc/${nazwa}`, {
    method: 'POST',
    body: JSON.stringify(argumenty),
  });
}

/** Szybki test polaczenia - uzywany przez /api/health i przy starcie. */
export async function sprawdzPolaczenie() {
  const stan = await funkcja('stan_systemu');
  return stan;
}
