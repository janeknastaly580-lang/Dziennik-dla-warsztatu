/**
 * Edge Function `parowanie` - dwie drogi wejscia do aplikacji.
 *
 *  A. KOD ZAPROSZENIA (od dostawcy uslugi) - zaklada warsztat i jego
 *     pierwszego administratora. Bez tego nikt nie ma jak zaczac.
 *  B. KOD PAROWANIA (z ekranu telefonu) - administrator warsztatu zatwierdza
 *     go w aplikacji, zdalnie, jednorazowo, bez zadnego hasla.
 *
 * WYMAGANIE: mechanik nie zna zadnego hasla do systemu. Mechanik ustawia
 * potem na telefonie dowolne wlasne haslo (blokada aplikacji). Administrator
 * moze tez dostep odebrac - wtedy telefon czysci lokalna baze.
 *
 * Przebieg drogi B:
 *   1. telefon:  { akcja: "zglos", imie: "Jan Kowalski" }
 *                -> dostaje KOD (8 znakow, pokazuje go na ekranie)
 *                   i SEKRET (256 bitow, trzyma u siebie)
 *                Imie i nazwisko wpisuje SAM MECHANIK - nikt inny nie zna
 *                pisowni jego nazwiska lepiej niz on.
 *   2. administrator widzi na swojej liscie gotowy wiersz (imie + kod)
 *   3. administrator klika "Zatwierdz". Nie wpisuje ani jednego znaku;
 *      konto mechanika zaklada sie samo z podanego imienia.
 *   4. telefon:  { akcja: "sprawdz", id, sekret }
 *                -> JEDEN RAZ odbiera token urzadzenia; kod i sekret gina
 *   5. telefon prosi mechanika o ustawienie hasla i melduje
 *      { akcja: "haslo_ustawione" }
 *
 * KOD nie jest sekretem - jego znajomosc nic nie daje, bo dostep i tak musi
 * klinac administrator, a token odbiera wylacznie ten, kto ma SEKRET.
 *
 * A2: ta funkcja dziala z kluczem service_role po stronie serwera. Klucz
 *     nigdy nie opuszcza Supabase - w aplikacji mobilnej go nie ma.
 * A11: do logow nie trafia zaden token, sekret ani dane osobowe.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_BAZY = Deno.env.get("SUPABASE_URL")!;
const KLUCZ_SERWERA = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(URL_BAZY, KLUCZ_SERWERA, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Alfabet bez znakow, ktore mozna pomylic (brak I, O, 0, 1). */
const ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const NAGLOWKI = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-token-urzadzenia",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function odpowiedz(status: number, cialo: unknown) {
  return new Response(JSON.stringify(cialo), { status, headers: NAGLOWKI });
}

/** A11: log bez danych osobowych i bez sekretow - sam kod zdarzenia. */
function log(zdarzenie: string, szczegoly: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ f: "parowanie", zdarzenie, ...szczegoly }));
}

async function sha256(tekst: string): Promise<string> {
  const bajty = new TextEncoder().encode(tekst);
  const skrot = await crypto.subtle.digest("SHA-256", bajty);
  return Array.from(new Uint8Array(skrot))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function losoweZnaki(ile: number, alfabet: string): string {
  const bajty = new Uint8Array(ile);
  crypto.getRandomValues(bajty);
  let wynik = "";
  for (const b of bajty) wynik += alfabet[b % alfabet.length];
  return wynik;
}

function losowyHex(bajtow: number): string {
  const b = new Uint8Array(bajtow);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function tekst(w: unknown, maks: number): string | null {
  if (typeof w !== "string") return null;
  const t = w.trim();
  return t === "" ? null : t.slice(0, maks);
}

/** Proste ograniczenie tempa - chroni liste oczekujacych przed zalaniem. */
async function limitPrzekroczony(klucz: string, maks: number, oknoMinut: number) {
  const teraz = new Date();
  const { data } = await db.from("limity").select("licznik, okno_do").eq("klucz", klucz).maybeSingle();

  if (!data || new Date(data.okno_do) < teraz) {
    const doKiedy = new Date(teraz.getTime() + oknoMinut * 60_000).toISOString();
    await db.from("limity").upsert({ klucz, licznik: 1, okno_do: doKiedy });
    return false;
  }
  if (data.licznik >= maks) return true;
  await db.from("limity").update({ licznik: data.licznik + 1 }).eq("klucz", klucz);
  return false;
}

/** Sprawdza, czy zadanie pochodzi z tego telefonu, ktory zaczal parowanie. */
async function zgloszenieZSekretem(id: string, sekret: string) {
  const { data } = await db
    .from("urzadzenia")
    .select("id, sekret_hash, kod_wygasa_o, przyznany_o, mechanik_id, warsztat_id, " +
            "zablokowane_o, powod_blokady, token_hash")
    .eq("id", id)
    .maybeSingle();
  // Ta sama odpowiedz dla nieznanego id i zlego sekretu - brak wyciekow.
  if (!data || data.sekret_hash !== (await sha256(sekret))) return null;
  return data;
}

/* ===================================================================== */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: NAGLOWKI });
  if (req.method !== "POST") return odpowiedz(405, { kod: "ZLA_METODA" });

  let cialo: Record<string, unknown>;
  try {
    cialo = await req.json();
  } catch {
    return odpowiedz(400, { kod: "BLEDNY_JSON" });
  }

  const akcja = tekst(cialo.akcja, 40);

  try {
    /* ------------------------- 1. ZGLOSZENIE ------------------------- */
    if (akcja === "zglos") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "nieznane";
      if (await limitPrzekroczony(`zglos:${ip}`, 20, 60)) {
        log("limit_zgloszen");
        return odpowiedz(429, { kod: "ZA_DUZO_ZGLOSZEN" });
      }

      const sekret = losowyHex(32);
      const wygasa = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

      // Kod musi byc unikalny - kilka prob wystarczy przy 32^8 mozliwosci.
      for (let proba = 0; proba < 5; proba++) {
        const kod = losoweZnaki(8, ALFABET);
        const { data, error } = await db
          .from("urzadzenia")
          .insert({
            kod_parowania: kod,
            sekret_hash: await sha256(sekret),
            kod_wygasa_o: wygasa,
            nazwa_urzadzenia: tekst(cialo.nazwa_urzadzenia, 120),
            // Imie i nazwisko deklarowane przez mechanika. Zwykly tekst -
            // niczego nie autoryzuje, sluzy tylko za nazwe zakladanego konta.
            imie_zgloszone: tekst(cialo.imie, 120),
            platforma: ["windows", "web"].includes(String(cialo.platforma))
              ? String(cialo.platforma)
              : "inne",
            wersja_aplikacji: tekst(cialo.wersja_aplikacji, 40),
            wersja_schematu: Number(cialo.wersja_schematu) || null,
          })
          .select("id")
          .single();

        if (!error && data) {
          log("zgloszenie_utworzone");
          return odpowiedz(200, { id: data.id, kod, sekret, wygasa_o: wygasa });
        }
        if (error && error.code !== "23505") throw error; // 23505 = kolizja kodu
      }
      return odpowiedz(503, { kod: "NIE_UDALO_SIE_WYGENEROWAC_KODU" });
    }

    /* ------------ 2. KOD ZAPROSZENIA: NOWY WARSZTAT ------------------ */
    /* Pierwszy telefon w warsztacie nie ma kogo poprosic o zgode. Kod
       zaproszenia zaklada warsztat i konto administratora, a token odbiera
       potem ta sama sciezka co przy zgodzie administratora. */
    if (akcja === "aktywuj_zaproszenie") {
      const id = tekst(cialo.id, 64);
      const sekret = tekst(cialo.sekret, 128);
      const kodZaproszenia = tekst(cialo.kod_zaproszenia, 24)?.toUpperCase();
      if (!id || !sekret || !kodZaproszenia) return odpowiedz(400, { kod: "BRAK_DANYCH" });

      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "nieznane";
      if (await limitPrzekroczony(`zapro:${ip}`, 30, 60)) {
        return odpowiedz(429, { kod: "ZA_DUZO_PROB" });
      }

      const u = await zgloszenieZSekretem(id, sekret);
      if (!u) return odpowiedz(404, { kod: "NIEZNANE_ZGLOSZENIE" });

      const { data, error } = await db.rpc("aktywuj_zaproszenie", {
        p_urzadzenie: id, p_kod: kodZaproszenia,
      });
      if (error) throw error;

      log("aktywacja_zaproszenia", { ok: !!data?.ok });
      return odpowiedz(200, data);
    }

    /* ------------------- 3. ODPYTANIE O ZGODE ------------------------ */
    if (akcja === "sprawdz") {
      const id = tekst(cialo.id, 64);
      const sekret = tekst(cialo.sekret, 128);
      if (!id || !sekret) return odpowiedz(400, { kod: "BRAK_DANYCH" });

      const u = await zgloszenieZSekretem(id, sekret);
      if (!u) return odpowiedz(404, { kod: "NIEZNANE_ZGLOSZENIE" });
      if (u.zablokowane_o) {
        return odpowiedz(403, { kod: "ZABLOKOWANE", powod: u.powod_blokady });
      }
      if (!u.przyznany_o) {
        const wygaslo = u.kod_wygasa_o && new Date(u.kod_wygasa_o) < new Date();
        return odpowiedz(200, { status: wygaslo ? "wygasl" : "oczekuje" });
      }

      // Zgoda administratora jest jednorazowa: wydajemy token, kasujemy kod
      // i sekret, zeby drugi telefon nie mogl sie podpiac tym samym kodem.
      const token = losowyHex(32);
      const { error: bladTokenu } = await db
        .from("urzadzenia")
        .update({
          token_hash: await sha256(token),
          token_wydany_o: new Date().toISOString(),
          kod_parowania: null,
          sekret_hash: null,
          kod_wygasa_o: null,
        })
        .eq("id", id)
        .is("token_hash", null);       // tylko gdy token nie zostal juz wydany

      if (bladTokenu) throw bladTokenu;

      const { data: po } = await db
        .from("urzadzenia").select("token_hash").eq("id", id).maybeSingle();
      if (!po?.token_hash) return odpowiedz(409, { kod: "TOKEN_JUZ_WYDANY" });

      const { data: mech } = await db
        .from("mechanicy").select("id, imie, rola").eq("id", u.mechanik_id!).maybeSingle();
      const { data: wars } = await db
        .from("warsztaty")
        .select("id, nazwa, prefiks, okno_dni, wygasniecie_offline_dni")
        .eq("id", u.warsztat_id!).maybeSingle();

      log("token_wydany");
      return odpowiedz(200, {
        status: "przyznany",
        token,
        urzadzenie_id: id,
        mechanik: mech,
        warsztat: wars,
        ustaw_haslo: true,
      });
    }

    /* --------------- 4. MECHANIK USTAWIL WLASNE HASLO ---------------- */
    if (akcja === "haslo_ustawione") {
      const token = req.headers.get("x-token-urzadzenia");
      if (!token) return odpowiedz(401, { kod: "BRAK_TOKENU" });
      const { error } = await db
        .from("urzadzenia")
        .update({ zadanie_resetu_hasla_o: null })
        .eq("token_hash", await sha256(token));
      if (error) throw error;
      log("haslo_ustawione");
      return odpowiedz(200, { ok: true });
    }

    return odpowiedz(400, { kod: "NIEZNANA_AKCJA" });
  } catch (err) {
    // A11: do logu idzie tylko komunikat techniczny, nigdy tresc zadania.
    log("blad", { tresc: String((err as Error)?.message ?? err).slice(0, 200) });
    return odpowiedz(500, { kod: "BLAD_SERWERA" });
  }
});
