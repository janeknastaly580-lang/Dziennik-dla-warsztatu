"""
Nowy kod zaproszenia dla administratora - jedno klikniecie.

Kliknij ten plik dwa razy. Skrypt nie robi nic wiecej: laczy sie z Supabase,
wystawia JEDEN nowy, jednorazowy kod zaproszenia z rola "administrator"
i wypisuje go na ekranie. Zadnych pytan, zadnych argumentow.

To samo, co `npm run zaproszenie`, tylko bez Node i bez wpisywania niczego.

Czego potrzebuje:
  - Python 3.8+ (tylko biblioteka standardowa),
  - pliku narzedzia/.env z SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY
    (ten sam plik, z ktorego korzystaja skrypty w narzedzia/scripts/).

Kod dolacza telefon do warsztatu, ktory juz istnieje w bazie (najstarszego).
Jesli baza jest pusta, kod zaklada nowy warsztat przy pierwszym uzyciu.
"""

import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

KATALOG = Path(__file__).resolve().parent
PLIK_ENV = KATALOG / ".env"

IMIE_NA_KODZIE = "Administrator (nowy telefon)"
DNI_WAZNOSCI = 14
NAZWA_NOWEGO_WARSZTATU = "Warsztat"


def wczytaj_env(sciezka):
    """Minimalny czytnik .env - bez dodatkowych paczek, tak jak w src/config.js."""
    wartosci = {}
    if not sciezka.exists():
        return wartosci
    for linia in sciezka.read_text(encoding="utf-8-sig").splitlines():
        t = linia.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        klucz, wartosc = t.split("=", 1)
        wartosci[klucz.strip()] = wartosc.strip().strip('"').strip("'")
    return wartosci


def zapytanie(url, klucz, sciezka, metoda="GET", cialo=None):
    zad = urllib.request.Request(
        url.rstrip("/") + sciezka,
        method=metoda,
        data=None if cialo is None else json.dumps(cialo).encode("utf-8"),
        headers={
            "apikey": klucz,
            "Authorization": "Bearer " + klucz,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(zad, timeout=20, context=ssl.create_default_context()) as odp:
            tresc = odp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        szczegoly = err.read().decode("utf-8", "replace")
        raise SystemError("Supabase odpowiedzial HTTP %s: %s" % (err.code, szczegoly))
    except urllib.error.URLError as err:
        raise SystemError("Brak polaczenia z Supabase (%s): %s" % (url, err.reason))
    return json.loads(tresc) if tresc else None


def do_schowka(tekst):
    """Wygoda, nie wymog - jak sie nie uda, kod i tak jest na ekranie."""
    try:
        subprocess.run(["clip"], input=tekst.encode("ascii", "ignore"), check=True, shell=True)
        return True
    except Exception:
        return False


def czytelna_data(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d.%m.%Y %H:%M")
    except Exception:
        return iso


def main():
    env = wczytaj_env(PLIK_ENV)
    url = (env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
    klucz = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

    if not url or not klucz:
        raise SystemError(
            "Brakuje SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w pliku:\n  %s\n"
            "Wzor: narzedzia/.env.example" % PLIK_ENV
        )

    warsztaty = zapytanie(
        url, klucz,
        "/rest/v1/warsztaty?select=id,nazwa&usuniete_o=is.null&order=utworzono.asc&limit=1",
    ) or []
    warsztat = warsztaty[0] if warsztaty else None

    wynik = zapytanie(
        url, klucz, "/rest/v1/rpc/utworz_zaproszenie", "POST",
        {
            "p_nazwa_warsztatu": None if warsztat else NAZWA_NOWEGO_WARSZTATU,
            "p_imie": IMIE_NA_KODZIE,
            "p_prefiks": None,
            "p_dni_waznosci": DNI_WAZNOSCI,
            "p_warsztat_id": warsztat["id"] if warsztat else None,
            "p_rola": "administrator",
        },
    )

    if not isinstance(wynik, dict) or not wynik.get("ok"):
        blad = (wynik or {}).get("blad", "nieznany blad")
        raise SystemError("Baza nie wystawila kodu: %s" % blad)

    kod = wynik["kod"]
    skopiowano = do_schowka(kod)

    print("")
    print("==============================================================")
    print("  KOD ZAPROSZENIA:   %s" % kod)
    print("==============================================================")
    print("  Rola          : administrator")
    print("  Warsztat      : %s" % (warsztat["nazwa"] if warsztat else NAZWA_NOWEGO_WARSZTATU + " (zalozy sie przy uzyciu kodu)"))
    print("  Wazny do      : %s" % czytelna_data(wynik.get("wygasa_o", "")))
    print("  Projekt       : %s" % url)
    if skopiowano:
        print("  (kod jest juz w schowku - wystarczy wkleic)")
    print("--------------------------------------------------------------")
    print("  W aplikacji: \"Mam kod zaproszenia\" -> wpisz kod -> ustaw haslo.")
    print("==============================================================")
    print("")
    print("Kod jest JEDNORAZOWY. Kto go uzyje, zostaje administratorem.")


if __name__ == "__main__":
    try:
        main()
    except SystemError as err:
        print("")
        print("Nie udalo sie wystawic kodu.")
        print(err)
    except Exception as err:  # okno nie ma prawa zniknac bez wyjasnienia
        print("")
        print("Nieoczekiwany blad: %s: %s" % (type(err).__name__, err))
    print("")
    try:
        input("Nacisnij Enter, zeby zamknac to okno...")
    except EOFError:
        pass
    sys.exit(0)
