/**
 * Edge Function `sync` - jedyna droga, ktora dane warsztatu wchodza i wychodza
 * z telefonu.
 *
 *  A1  Tabele maja RLS bez polityk, a rola `anon` nie ma nawet wstepu do
 *      schematu. Klucz wbudowany w aplikacje nie odczyta niczego wprost -
 *      wszystko idzie przez ta funkcje, ktora sprawdza token urzadzenia.
 *  A2  Klucz service_role zyje wylacznie tutaj, po stronie Supabase.
 *  A3  Okno synchronizacji jest OSOBNA warstwa bezpieczenstwa, niezalezna od
 *      RLS: telefon dostaje kartoteki swojego warsztatu oraz wizyty z
 *      ostatnich `okno_dni` dni plus wszystkie nadal otwarte. Nigdy calej bazy.
 *  A6  Blokada mechanika lub urzadzenia dziala przy najblizszym kontakcie.
 *  A11 Do logow nie trafiaja dane osobowe ani tresc zadan.
 *  B8  ZADEN blad danych nie konczy sie trwalym 4xx. Rekord, ktorego nie da
 *      sie zapisac, ladzie w kwarantannie, a telefon dostaje potwierdzenie
 *      przyjecia - kolejka nigdy sie nie zatyka.
 *  B10 Telefon podaje wersje schematu. Zbyt stara wersja dostaje prosbe o
 *      aktualizacje, ale jej ZAPISY SA NADAL PRZYJMOWANE - nikt nie traci
 *      pracy przez to, ze nie zaktualizowal aplikacji.
 *  D1  Token urzadzenia nie wygasa. Nie ma odswiezania sesji, wiec brak
 *      sieci nie moze nikogo wylogowac.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** B10: wersja schematu wymiany danych. */
const WERSJA_SCHEMATU = 1;
const MIN_WERSJA_SCHEMATU = 1;

const MAKS_ZMIAN_NA_ZADANIE = 200;
const DOMYSLNY_LIMIT_POBRANIA = 500;

/** B13: kolumny, ktore telefon w ogole moze przyslac. */
const DOZWOLONE: Record<string, string[]> = {
  klienci: ["nazwa", "telefon", "email", "adres", "nip", "notatki"],
  wizyty: ["klient_id", "auto", "tytul", "opis", "status", "priorytet",
           "data_wizyty", "data_zamkniecia", "przebieg", "koszt", "numer_roboczy"],
  dziennik_dostepu: ["akcja", "klient_id", "wizyta_id"],
};
const OPERACJE = ["wstaw", "zmien", "usun", "scal"];

const NAGLOWKI = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-token-urzadzenia",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const odpowiedz = (status: number, cialo: unknown) =>
  new Response(JSON.stringify(cialo), { status, headers: NAGLOWKI });

/** A11: log bez danych osobowych - same kody i liczby. */
function log(zdarzenie: string, szczegoly: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ f: "sync", zdarzenie, ...szczegoly }));
}

async function sha256(tekst: string): Promise<string> {
  const skrot = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return Array.from(new Uint8Array(skrot))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zostawia wylacznie dozwolone kolumny i przycina dlugosci (B13). */
function oczysc(tabela: string, pola: unknown): Record<string, unknown> {
  const dozwolone = DOZWOLONE[tabela] ?? [];
  const wynik: Record<string, unknown> = {};
  if (!pola || typeof pola !== "object") return wynik;
  for (const [k, v] of Object.entries(pola as Record<string, unknown>)) {
    if (!dozwolone.includes(k)) continue;
    if (typeof v === "string") wynik[k] = v.slice(0, 8000);
    else if (v === null || typeof v === "number" || typeof v === "boolean") wynik[k] = v;
  }
  return wynik;
}

/* ===================================================================== */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: NAGLOWKI });
  if (req.method !== "POST") return odpowiedz(405, { kod: "ZLA_METODA" });

  const token = req.headers.get("x-token-urzadzenia");
  if (!token || token.length < 32) return odpowiedz(401, { kod: "BRAK_TOKENU" });

  let cialo: Record<string, unknown>;
  try {
    cialo = await req.json();
  } catch {
    return odpowiedz(400, { kod: "BLEDNY_JSON" });
  }

  try {
    /* ---------------------- uwierzytelnienie ---------------------- */
    const { data: sesja, error: bladAuth } = await db.rpc("uwierzytelnij_urzadzenie", {
      p_token_hash: await sha256(token),
      p_wersja_apl: typeof cialo.wersja_aplikacji === "string"
        ? cialo.wersja_aplikacji.slice(0, 40) : null,
      p_wersja_schematu: Number(cialo.wersja_schematu) || null,
    });
    if (bladAuth) throw bladAuth;

    if (!sesja?.znalezione) {
      // A6: administrator uniewaznil sesje - telefon ma sie wyczyscic.
      return odpowiedz(401, { kod: "NIEZNANY_TOKEN" });
    }
    if (sesja.wyczysc) {
      log("polecenie_wyczyszczenia");
      return odpowiedz(403, { kod: "WYCZYSC", powod: sesja.powod_blokady });
    }
    if (sesja.zablokowane) {
      log("dostep_zablokowany");
      return odpowiedz(403, { kod: "ZABLOKOWANE", powod: sesja.powod_blokady });
    }
    if (!sesja.warsztat_id || !sesja.mechanik_id) {
      return odpowiedz(403, { kod: "NIEPRZYPISANE" });
    }

    const wersjaKlienta = Number(cialo.wersja_schematu) || 0;
    const wymagaAktualizacji = wersjaKlienta < MIN_WERSJA_SCHEMATU;

    const wspolne = {
      serwer_czas: new Date().toISOString(),
      wersja_schematu: WERSJA_SCHEMATU,
      wymaga_aktualizacji: wymagaAktualizacji,
      mechanik: {
        id: sesja.mechanik_id,
        imie: sesja.mechanik_imie,
        // Rola decyduje, czy telefon pokaze ekran zarzadzania dostepem.
        // Przychodzi przy kazdej synchronizacji, wiec odebranie uprawnien
        // administratora dziala natychmiast.
        rola: sesja.rola ?? "mechanik",
      },
      warsztat: {
        id: sesja.warsztat_id,
        nazwa: sesja.warsztat_nazwa,
        prefiks: sesja.prefiks,
        okno_dni: sesja.okno_dni,
      },
      polecenia: { reset_hasla: !!sesja.reset_hasla },
      wygasniecie_offline_dni: sesja.wygasniecie_offline_dni,
    };

    const akcja = String(cialo.akcja ?? "");

    /* --------------------------- STAN ----------------------------- */
    if (akcja === "stan") {
      return odpowiedz(200, { ok: true, ...wspolne });
    }

    /* --------------------------- PULL ----------------------------- */
    if (akcja === "pull") {
      // B10: stara aplikacja nie dostaje danych, ale nadal moze je wysylac.
      if (wymagaAktualizacji) {
        return odpowiedz(200, { ok: false, kod: "WYMAGANA_AKTUALIZACJA", ...wspolne });
      }

      const kursory = (cialo.kursory ?? {}) as Record<string, { ts?: string; id?: string } | null>;
      const limit = Math.min(Math.max(Number(cialo.limit) || DOMYSLNY_LIMIT_POBRANIA, 1), 1000);

      const kurKlienci = kursory.klienci ?? null;
      const kurWizyty = kursory.wizyty ?? null;

      const [rk, rw] = await Promise.all([
        db.rpc("pobierz_klientow", {
          p_warsztat: sesja.warsztat_id,
          p_kursor_ts: kurKlienci?.ts ?? null,
          p_kursor_id: kurKlienci?.id ?? null,
          p_limit: limit,
        }),
        db.rpc("pobierz_wizyty", {
          p_warsztat: sesja.warsztat_id,
          p_okno_dni: sesja.okno_dni,
          p_kursor_ts: kurWizyty?.ts ?? null,
          p_kursor_id: kurWizyty?.id ?? null,
          p_limit: limit,
        }),
      ]);
      if (rk.error) throw rk.error;
      if (rw.error) throw rw.error;

      const klienci = (rk.data ?? []) as Record<string, unknown>[];
      const wizyty = (rw.data ?? []) as Record<string, unknown>[];

      const ostatni = (lista: Record<string, unknown>[], poprzedni: unknown) =>
        lista.length
          ? { ts: lista[lista.length - 1].zapisane_o, id: lista[lista.length - 1].id }
          : poprzedni ?? null;

      await db.from("urzadzenia")
        .update({ ostatnia_sync_o: new Date().toISOString() })
        .eq("id", sesja.urzadzenie_id);

      const oknoOd = new Date(Date.now() - Number(sesja.okno_dni) * 86_400_000)
        .toISOString().slice(0, 10);

      log("pull", { klienci: klienci.length, wizyty: wizyty.length });

      return odpowiedz(200, {
        ok: true,
        ...wspolne,
        okno_od: oknoOd,
        klienci,
        wizyty,
        kursory: {
          klienci: ostatni(klienci, kurKlienci),
          wizyty: ostatni(wizyty, kurWizyty),
        },
        // Kolejna strona jest potrzebna, gdy ktorakolwiek tabela zwrocila
        // pelna paczke - telefon powtarza pull, az obie beda krotsze.
        wiecej: klienci.length >= limit || wizyty.length >= limit,
      });
    }

    /* --------------------------- PUSH ----------------------------- */
    if (akcja === "push") {
      const zmiany = Array.isArray(cialo.zmiany) ? cialo.zmiany : [];
      if (zmiany.length > MAKS_ZMIAN_NA_ZADANIE) {
        return odpowiedz(413, { kod: "ZA_DUZO_ZMIAN", maks: MAKS_ZMIAN_NA_ZADANIE });
      }

      const wyniki: Record<string, unknown>[] = [];
      let doKwarantanny = 0;

      for (const z of zmiany as Record<string, unknown>[]) {
        const idLokalne = String(z.id_lokalne ?? "");
        const tabela = String(z.tabela ?? "");
        const rekord = String(z.rekord_id ?? "");
        const operacja = String(z.operacja ?? "");
        const pola = operacja === "scal"
          ? { docelowy: String((z.pola as Record<string, unknown>)?.docelowy ?? "") }
          : oczysc(tabela, z.pola);

        // Klucz idempotencji (B12). Zawsze poprawny - nawet gdyby telefon
        // przyslal smiec, bo blad na tym poziomie zatrzymalby cala kolejke.
        const klucz = `${sesja.urzadzenie_id}:${idLokalne || crypto.randomUUID()}`.slice(0, 200);

        // Kontrola wstepna. Zamiast odrzucic - odkladamy do kwarantanny (B8).
        let wstepnyBlad: string | null = null;
        if (!DOZWOLONE[tabela]) wstepnyBlad = `Nieznana tabela: ${tabela}`;
        else if (!OPERACJE.includes(operacja)) wstepnyBlad = `Nieznana operacja: ${operacja}`;
        else if (!UUID.test(rekord)) wstepnyBlad = "Identyfikator rekordu nie jest UUID";

        if (wstepnyBlad) {
          await db.rpc("do_kwarantanny", {
            p_warsztat: sesja.warsztat_id,
            p_urzadzenie: sesja.urzadzenie_id,
            p_mechanik: sesja.mechanik_id,
            p_tabela: tabela.slice(0, 60) || "nieznana",
            p_rekord: UUID.test(rekord) ? rekord : null,
            p_operacja: operacja.slice(0, 40) || "nieznana",
            p_ladunek: pola,
            p_blad: wstepnyBlad,
          });
          doKwarantanny++;
          wyniki.push({ id_lokalne: idLokalne, status: "kwarantanna", blad: wstepnyBlad });
          continue;
        }

        try {
          const { data, error } = await db.rpc("zapisz_z_telefonu", {
            p_urzadzenie: sesja.urzadzenie_id,
            p_mechanik: sesja.mechanik_id,
            p_warsztat: sesja.warsztat_id,
            p_klucz: klucz,
            p_tabela: tabela,
            p_rekord: rekord,
            p_operacja: operacja,
            p_pola: pola,
            p_zrobione_o: typeof z.zrobione_o === "string" ? z.zrobione_o : null,
          });
          if (error) throw error;
          if (data?.status === "kwarantanna") doKwarantanny++;
          wyniki.push({ id_lokalne: idLokalne, ...(data as Record<string, unknown>) });
        } catch (err) {
          // Ostatnia siatka bezpieczenstwa (B8): nawet awaria funkcji SQL
          // nie moze zatrzymac kolejki. Rekord idzie do kwarantanny, a
          // telefon dostaje potwierdzenie przyjecia.
          const tresc = String((err as Error)?.message ?? err).slice(0, 300);
          await db.rpc("do_kwarantanny", {
            p_warsztat: sesja.warsztat_id,
            p_urzadzenie: sesja.urzadzenie_id,
            p_mechanik: sesja.mechanik_id,
            p_tabela: tabela, p_rekord: rekord, p_operacja: operacja,
            p_ladunek: pola, p_blad: tresc,
          }).catch(() => {});
          doKwarantanny++;
          wyniki.push({ id_lokalne: idLokalne, status: "kwarantanna", blad: tresc });
        }
      }

      await db.from("urzadzenia")
        .update({ ostatnia_sync_o: new Date().toISOString() })
        .eq("id", sesja.urzadzenie_id);

      log("push", { zmian: zmiany.length, kwarantanna: doKwarantanny });
      return odpowiedz(200, { ok: true, ...wspolne, wyniki });
    }

    return odpowiedz(400, { kod: "NIEZNANA_AKCJA" });
  } catch (err) {
    // Awaria po stronie serwera to 5xx - telefon ma PONOWIC, a nie wyrzucic
    // dane. Nigdy nie zamieniamy jej na 4xx (B8).
    log("blad", { tresc: String((err as Error)?.message ?? err).slice(0, 200) });
    return odpowiedz(503, { kod: "BLAD_SERWERA", ponow: true });
  }
});
