/**
 * Edge Function `admin` - uprawnienia administratora warsztatu.
 *
 * Administrator to mechanik z rola "administrator". Ponad zwyklego mechanika
 * moze DOKLADNIE tyle:
 *   1. zatwierdzic telefon czekajacy na dostep - jednym klikiem, bez wpisywania
 *      czegokolwiek (telefon sam poprosi mechanika o ustawienie wlasnego hasla),
 *   2. odebrac dostep mechanikowi albo pojedynczemu telefonowi.
 * Nie widzi wiecej danych klientow niz ktokolwiek inny.
 *
 * Uwierzytelnienie wlasne (verify_jwt = false): naglowek x-token-urzadzenia.
 * Rola jest sprawdzana DWA RAZY - tutaj i w kazdej funkcji SQL - wiec sama
 * podmiana zadania z telefonu mechanika niczego nie da.
 *
 * Klucz service_role zyje wylacznie tutaj, po stronie Supabase. Dostawca
 * uslugi nie hostuje niczego u siebie.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const NAGLOWKI = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-token-urzadzenia",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const odpowiedz = (status: number, cialo: unknown) =>
  new Response(JSON.stringify(cialo), { status, headers: NAGLOWKI });

/** A11: log bez danych osobowych. */
const log = (zdarzenie: string, s: Record<string, string | number | boolean> = {}) =>
  console.log(JSON.stringify({ f: "admin", zdarzenie, ...s }));

async function sha256(t: string) {
  const s = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(s)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tekst = (w: unknown, maks: number) =>
  typeof w === "string" && w.trim() ? w.trim().slice(0, maks) : null;

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
    const { data: sesja, error } = await db.rpc("uwierzytelnij_urzadzenie", {
      p_token_hash: await sha256(token),
      p_wersja_apl: null,
      p_wersja_schematu: null,
    });
    if (error) throw error;

    if (!sesja?.znalezione) return odpowiedz(401, { kod: "NIEZNANY_TOKEN" });
    if (sesja.wyczysc) return odpowiedz(403, { kod: "WYCZYSC", powod: sesja.powod_blokady });
    if (sesja.zablokowane) return odpowiedz(403, { kod: "ZABLOKOWANE", powod: sesja.powod_blokady });
    if (sesja.rola !== "administrator") {
      log("odmowa_brak_roli");
      return odpowiedz(403, { kod: "BRAK_UPRAWNIEN" });
    }

    const wykonawca = sesja.mechanik_id as string;
    const akcja = String(cialo.akcja ?? "");

    /** Wywolanie funkcji SQL, ktora i tak sama sprawdza uprawnienia. */
    const wywolaj = async (nazwa: string, argumenty: Record<string, unknown>) => {
      const { data, error: bl } = await db.rpc(nazwa, argumenty);
      if (bl) throw bl;
      return data;
    };

    switch (akcja) {
      case "dane":
        return odpowiedz(200, {
          ok: true,
          ...(await wywolaj("dane_administracyjne", { p_wykonawca: wykonawca })),
        });

      case "dodaj_mechanika": {
        const imie = tekst(cialo.imie, 120);
        if (!imie) return odpowiedz(200, { ok: false, blad: "Podaj imie i nazwisko" });
        log("dodanie_mechanika");
        return odpowiedz(200, await wywolaj("admin_dodaj_mechanika", {
          p_wykonawca: wykonawca, p_imie: imie,
          p_rola: cialo.rola === "administrator" ? "administrator" : "mechanik",
        }));
      }

      /* Jeden klik: kod wiersza, ktory administrator dotknal. Konto mechanika
         powstaje po stronie bazy, z imienia podanego przez samego mechanika. */
      case "zatwierdz": {
        const kod = tekst(cialo.kod, 8)?.toUpperCase();
        if (!kod) return odpowiedz(200, { ok: false, blad: "Nie wskazano telefonu" });
        log("zatwierdzenie_urzadzenia");
        return odpowiedz(200, await wywolaj("admin_zatwierdz_urzadzenie", {
          p_wykonawca: wykonawca, p_kod: kod,
        }));
      }

      case "przyznaj": {
        const kod = tekst(cialo.kod, 8)?.toUpperCase();
        const mechanik = tekst(cialo.mechanik_id, 64);
        if (!kod || !mechanik || !UUID.test(mechanik)) {
          return odpowiedz(200, { ok: false, blad: "Podaj kod z telefonu i wybierz mechanika" });
        }
        log("przyznanie_dostepu");
        return odpowiedz(200, await wywolaj("admin_przyznaj_dostep", {
          p_wykonawca: wykonawca, p_kod: kod, p_mechanik: mechanik,
        }));
      }

      case "zablokuj_mechanika": {
        const mechanik = tekst(cialo.mechanik_id, 64);
        if (!mechanik || !UUID.test(mechanik)) {
          return odpowiedz(200, { ok: false, blad: "Nie wskazano mechanika" });
        }
        log("blokada_mechanika");
        return odpowiedz(200, await wywolaj("admin_zablokuj_mechanika", {
          p_wykonawca: wykonawca, p_mechanik: mechanik, p_powod: tekst(cialo.powod, 500),
        }));
      }

      case "odblokuj_mechanika": {
        const mechanik = tekst(cialo.mechanik_id, 64);
        if (!mechanik || !UUID.test(mechanik)) {
          return odpowiedz(200, { ok: false, blad: "Nie wskazano mechanika" });
        }
        log("odblokowanie_mechanika");
        return odpowiedz(200, await wywolaj("admin_odblokuj_mechanika", {
          p_wykonawca: wykonawca, p_mechanik: mechanik,
        }));
      }

      case "urzadzenie": {
        const urzadzenie = tekst(cialo.urzadzenie_id, 64);
        const co = String(cialo.co ?? "");
        if (!urzadzenie || !UUID.test(urzadzenie)) {
          return odpowiedz(200, { ok: false, blad: "Nie wskazano telefonu" });
        }
        if (!["zablokuj", "odblokuj", "wyrejestruj", "reset_hasla"].includes(co)) {
          return odpowiedz(200, { ok: false, blad: "Nieznana akcja" });
        }
        log("akcja_na_urzadzeniu", { co });
        return odpowiedz(200, await wywolaj("admin_urzadzenie", {
          p_wykonawca: wykonawca, p_urzadzenie: urzadzenie,
          p_akcja: co, p_powod: tekst(cialo.powod, 500),
        }));
      }

      default:
        return odpowiedz(400, { kod: "NIEZNANA_AKCJA" });
    }
  } catch (err) {
    log("blad", { tresc: String((err as Error)?.message ?? err).slice(0, 200) });
    return odpowiedz(503, { kod: "BLAD_SERWERA", ponow: true });
  }
});
