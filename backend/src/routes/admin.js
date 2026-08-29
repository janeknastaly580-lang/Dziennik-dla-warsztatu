/**
 * /api - panel administratora warsztatu.
 *
 * Co tu jest i po co:
 *  - przyznawanie dostepu telefonom (kod parowania -> mechanik)     [wymaganie]
 *  - blokowanie mechanika lub telefonu, zdalne czyszczenie danych   [A4, A6]
 *  - wymuszenie ustawienia nowego hasla na telefonie                [wymaganie]
 *  - podglad kwarantanny, zeby zaden zapis z telefonu nie przepadl  [B8]
 *  - podglad mozliwych duplikatow i ich scalanie                    [B3]
 *  - dziennik dostepu: kto, kiedy, ktora kartoteke otwieral         [A10]
 *  - reczne uruchomienie retencji danych                            [B2, A15]
 */
import crypto from 'node:crypto';
import { Router } from 'express';

import { funkcja, wybierz, wstaw, zmien } from '../supabase.js';
import { HASLO_PANELU, NAZWA_ADMINISTRATORA } from '../config.js';
import {
  asyncHandler, bledneZadanie, brakDostepu, liczbaZZakresu, tekst, tekstWymagany, uuid,
} from '../pomocnicze.js';

const router = Router();

/* ===================================================================== */
/*  Logowanie do panelu                                                  */
/*  Panel stoi na 127.0.0.1, ale klucz service_role za nim jest na tyle   */
/*  wrazliwy, ze i tak wymagamy hasla.                                   */
/* ===================================================================== */

const sesje = new Map(); // token -> wygasa (ms)
const CZAS_SESJI_MS = 8 * 60 * 60 * 1000;

function rownePorownanie(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function czytajCiastko(req, nazwa) {
  const naglowek = req.headers.cookie || '';
  for (const czesc of naglowek.split(';')) {
    const [k, ...v] = czesc.trim().split('=');
    if (k === nazwa) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function wymagajLogowania(req, _res, next) {
  const token = czytajCiastko(req, 'panel_sesja');
  const wygasa = token ? sesje.get(token) : null;
  if (!wygasa || wygasa < Date.now()) {
    if (token) sesje.delete(token);
    return next(brakDostepu('Zaloguj sie do panelu'));
  }
  sesje.set(token, Date.now() + CZAS_SESJI_MS);
  return next();
}

router.post('/logowanie', asyncHandler((req, res) => {
  if (!HASLO_PANELU) {
    throw bledneZadanie('Nie ustawiono HASLO_PANELU w backend/.env');
  }
  if (!rownePorownanie(tekst(req.body?.haslo) ?? '', HASLO_PANELU)) {
    throw brakDostepu('Nieprawidlowe haslo');
  }
  const token = crypto.randomBytes(32).toString('hex');
  sesje.set(token, Date.now() + CZAS_SESJI_MS);
  res.setHeader(
    'Set-Cookie',
    `panel_sesja=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${CZAS_SESJI_MS / 1000}`,
  );
  res.json({ ok: true, administrator: NAZWA_ADMINISTRATORA });
}));

router.post('/wyloguj', asyncHandler((req, res) => {
  const token = czytajCiastko(req, 'panel_sesja');
  if (token) sesje.delete(token);
  res.setHeader('Set-Cookie', 'panel_sesja=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

/* ===================================================================== */
/*  Wszystko ponizej wymaga zalogowania                                  */
/* ===================================================================== */
router.use(wymagajLogowania);

/* ------------------------------- STAN -------------------------------- */

router.get('/stan', asyncHandler(async (_req, res) => {
  const [stan, urzadzenia] = await Promise.all([
    funkcja('stan_systemu'),
    funkcja('raport_synchronizacji'),
  ]);
  res.json({ stan, urzadzenia });
}));

/* ---------------------------- WARSZTATY ------------------------------ */

router.get('/warsztaty', asyncHandler(async (_req, res) => {
  res.json(await wybierz('warsztaty', 'usuniete_o=is.null&order=nazwa.asc'));
}));

router.post('/warsztaty', asyncHandler(async (req, res) => {
  const prefiks = tekstWymagany(req.body?.prefiks, 'prefiks').toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(prefiks)) {
    throw bledneZadanie('Prefiks to 1-4 znaki: wielkie litery lub cyfry (np. W1)');
  }
  const [warsztat] = await wstaw('warsztaty', {
    nazwa: tekstWymagany(req.body?.nazwa, 'nazwa'),
    prefiks,
  });
  res.status(201).json(warsztat);
}));

/**
 * A3 + A4: okno synchronizacji i czas do samoczynnego wyczyszczenia telefonu
 * sa ustawieniem warsztatu, nie stala w kodzie.
 */
router.patch('/warsztaty/:id', asyncHandler(async (req, res) => {
  const id = uuid(req.params.id);
  const zmiany = {};
  const okno = liczbaZZakresu(req.body?.okno_dni, 7, 3650, 'okno_dni');
  const ret = liczbaZZakresu(req.body?.retencja_dni, 30, 3650, 'retencja_dni');
  const wyg = liczbaZZakresu(req.body?.wygasniecie_offline_dni, 1, 90, 'wygasniecie_offline_dni');
  if (okno !== null) zmiany.okno_dni = okno;
  if (ret !== null) zmiany.retencja_dni = ret;
  if (wyg !== null) zmiany.wygasniecie_offline_dni = wyg;
  if (!Object.keys(zmiany).length) throw bledneZadanie('Brak pol do zmiany');

  const [warsztat] = await zmien('warsztaty', `id=eq.${id}`, zmiany);
  res.json(warsztat);
}));

/* ---------------------------- MECHANICY ------------------------------ */

router.get('/mechanicy', asyncHandler(async (_req, res) => {
  const mechanicy = await wybierz(
    'mechanicy',
    'usuniete_o=is.null&order=imie.asc&select=id,warsztat_id,imie,rola,zablokowany_o,powod_blokady,utworzono',
  );
  const urzadzenia = await wybierz(
    'urzadzenia',
    'usuniete_o=is.null&token_hash=not.is.null&select=id,mechanik_id,platforma,nazwa_urzadzenia,'
    + 'wersja_aplikacji,ostatnia_sync_o,zablokowane_o,zadanie_resetu_hasla_o,token_wydany_o',
  );
  res.json(mechanicy.map((m) => ({
    ...m,
    urzadzenia: urzadzenia.filter((u) => u.mechanik_id === m.id),
  })));
}));

router.post('/mechanicy', asyncHandler(async (req, res) => {
  const [mechanik] = await wstaw('mechanicy', {
    warsztat_id: uuid(req.body?.warsztat_id, 'warsztat_id'),
    imie: tekstWymagany(req.body?.imie, 'imie'),
    rola: ['mechanik', 'kierownik'].includes(req.body?.rola) ? req.body.rola : 'mechanik',
  });
  res.status(201).json(mechanik);
}));

/** A6: odciecie bylego pracownika - jeden przycisk, wszystkie jego telefony. */
router.post('/mechanicy/:id/zablokuj', asyncHandler(async (req, res) => {
  res.json(await funkcja('zablokuj_mechanika', {
    p_mechanik: uuid(req.params.id),
    p_powod: tekst(req.body?.powod) ?? 'zablokowany przez administratora',
    p_kto: NAZWA_ADMINISTRATORA,
    p_wyczysc: req.body?.wyczysc !== false,
  }));
}));

router.post('/mechanicy/:id/odblokuj', asyncHandler(async (req, res) => {
  res.json(await funkcja('odblokuj_mechanika', {
    p_mechanik: uuid(req.params.id),
    p_kto: NAZWA_ADMINISTRATORA,
  }));
}));

/* ---------------------------- URZADZENIA ----------------------------- */

/** Telefony czekajace na zgode administratora (pokazuja kod na ekranie). */
router.get('/urzadzenia/oczekujace', asyncHandler(async (_req, res) => {
  res.json(await wybierz(
    'urzadzenia',
    'przyznany_o=is.null&usuniete_o=is.null&kod_parowania=not.is.null'
    + '&order=utworzono.desc&select=id,kod_parowania,kod_wygasa_o,platforma,'
    + 'nazwa_urzadzenia,wersja_aplikacji,utworzono',
  ));
}));

/**
 * TO JEST TA FUNKCJA Z WYMAGANIA:
 * administrator wpisuje kod z ekranu telefonu, wybiera mechanika i telefon
 * dostaje dostep - zdalnie, jednorazowo, bez podawania jakiegokolwiek hasla.
 * Mechanik ustawia potem wlasne haslo do blokady aplikacji.
 */
router.post('/urzadzenia/przyznaj', asyncHandler(async (req, res) => {
  const wynik = await funkcja('przyznaj_dostep', {
    p_kod: tekstWymagany(req.body?.kod, 'kod').toUpperCase(),
    p_mechanik: uuid(req.body?.mechanik_id, 'mechanik_id'),
    p_kto: NAZWA_ADMINISTRATORA,
  });
  if (!wynik?.ok) throw bledneZadanie(wynik?.blad ?? 'Nie udalo sie przyznac dostepu');
  res.json(wynik);
}));

router.post('/urzadzenia/:id/zablokuj', asyncHandler(async (req, res) => {
  res.json(await funkcja('zablokuj_urzadzenie', {
    p_urzadzenie: uuid(req.params.id),
    p_powod: tekst(req.body?.powod) ?? 'zablokowane przez administratora',
    p_kto: NAZWA_ADMINISTRATORA,
    p_wyczysc: req.body?.wyczysc !== false,
  }));
}));

router.post('/urzadzenia/:id/odblokuj', asyncHandler(async (req, res) => {
  res.json(await funkcja('odblokuj_urzadzenie', {
    p_urzadzenie: uuid(req.params.id), p_kto: NAZWA_ADMINISTRATORA,
  }));
}));

/** A4: telefon zgubiony na dobre - sesja gasnie, dane maja zniknac. */
router.post('/urzadzenia/:id/wyrejestruj', asyncHandler(async (req, res) => {
  res.json(await funkcja('wyrejestruj_urzadzenie', {
    p_urzadzenie: uuid(req.params.id), p_kto: NAZWA_ADMINISTRATORA,
  }));
}));

/** Mechanik zapomnial hasla - administrator kaze ustawic nowe. */
router.post('/urzadzenia/:id/reset-hasla', asyncHandler(async (req, res) => {
  res.json(await funkcja('wymus_nowe_haslo', {
    p_urzadzenie: uuid(req.params.id), p_kto: NAZWA_ADMINISTRATORA,
  }));
}));

/* --------------------------- KWARANTANNA ----------------------------- */
/* B8: tu widac wszystko, czego baza nie przyjela. Kolejka na telefonie   */
/*     idzie dalej, ale te wpisy wymagaja decyzji czlowieka.              */

router.get('/kwarantanna', asyncHandler(async (_req, res) => {
  res.json(await wybierz('kwarantanna', 'rozwiazane_o=is.null&order=przyjete_o.desc&limit=200'));
}));

router.post('/kwarantanna/:id/rozwiaz', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw bledneZadanie('Nieprawidlowy identyfikator');
  const [wpis] = await zmien('kwarantanna', `id=eq.${id}`, {
    rozwiazane_o: new Date().toISOString(),
    rozwiazal: NAZWA_ADMINISTRATORA,
    uwagi: tekst(req.body?.uwagi),
  });
  res.json(wpis);
}));

/* ---------------------------- DUPLIKATY ------------------------------ */
/* B3: dwa warsztaty offline zalozyly te sama kartoteke - nic sie nie     */
/*     nadpisalo, wiec system musi to pokazac czlowiekowi.                */

router.get('/duplikaty', asyncHandler(async (_req, res) => {
  const duplikaty = await wybierz(
    'mozliwe_duplikaty', 'rozwiazane_o=is.null&order=wykryte_o.desc&limit=200',
  );
  const idy = [...new Set(duplikaty.flatMap((d) => [d.rekord_id, d.podobny_do]))];
  const klienci = idy.length
    ? await wybierz('klienci', `id=in.(${idy.join(',')})&select=id,nazwa,telefon,usuniete_o`)
    : [];
  const wizyty = idy.length
    ? await wybierz('wizyty', `id=in.(${idy.join(',')})&select=id,tytul,auto,status,data_wizyty`)
    : [];
  res.json({ duplikaty, klienci, wizyty });
}));

router.post('/duplikaty/:id/rozwiaz', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw bledneZadanie('Nieprawidlowy identyfikator');
  const [wpis] = await zmien('mozliwe_duplikaty', `id=eq.${id}`, {
    rozwiazane_o: new Date().toISOString(),
  });
  res.json(wpis);
}));

/* ------------------------- DZIENNIK DOSTEPU -------------------------- */
/* A10: nie zablokuje wyniesienia danych, ale pozwala je odtworzyc.       */

router.get('/dziennik', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const wpisy = await wybierz('dziennik_dostepu', `order=kiedy.desc&limit=${limit}`);
  const mechanicy = await wybierz('mechanicy', 'select=id,imie');
  res.json({ wpisy, mechanicy });
}));

router.get('/dziennik-admina', asyncHandler(async (_req, res) => {
  res.json(await wybierz('dziennik_admina', 'order=kiedy.desc&limit=200'));
}));

/* ---------------------------- RETENCJA ------------------------------- */

router.post('/retencja', asyncHandler(async (_req, res) => {
  res.json(await funkcja('zadanie_retencji'));
}));

export default router;
