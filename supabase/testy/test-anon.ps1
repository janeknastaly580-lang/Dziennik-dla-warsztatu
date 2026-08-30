# =====================================================================
#  A1 - TEST PRAKTYCZNY: co widzi klucz wbudowany w aplikacje mobilna?
#
#  Klucz anon jest publiczny z zalozenia - siedzi w paczce .apk/.ipa,
#  ktora kazdy rozpakuje w kilka minut. Ten test sprawdza, czy z samym
#  tym kluczem, bez logowania, da sie cokolwiek odczytac z bazy.
#
#  JESLI KTORAKOLWIEK TABELA ZWROCI DANE - MASZ DZIURE.
#
#  URUCHAMIAJ PO KAZDEJ ZMIANIE SCHEMATU. Nowa tabela bez RLS to
#  najczestsza przyczyna wyciekow z Supabase.
#
#  Uzycie:
#     powershell -ExecutionPolicy Bypass -File supabase\testy\test-anon.ps1
# =====================================================================

$ErrorActionPreference = 'Continue'

$Url = 'https://tpigqlvwjatlkhfqtlkt.supabase.co'
$Anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaWdxbHZ3amF0bGtoZnF0bGt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjE0MTMsImV4cCI6MjEwMzU5NzQxM30.EzdtM7UGsdyIlKuAX7JMY12jrxGuVWy6OOmRajn1MxY'

$Tabele = @(
  'klienci', 'wizyty', 'mechanicy', 'urzadzenia', 'warsztaty',
  'kwarantanna', 'mozliwe_duplikaty', 'dziennik_dostepu', 'dziennik_admina',
  'operacje', 'numeratory', 'limity', 'zaproszenia'
)

$Naglowki = @{ apikey = $Anon; Authorization = "Bearer $Anon" }
$Wpadki = 0

Write-Host ''
Write-Host 'A1 - test kluczem publicznym (anon)' -ForegroundColor Cyan
Write-Host "Projekt: $Url"
Write-Host ('-' * 70)

foreach ($t in $Tabele) {
  try {
    $odp = Invoke-WebRequest -Uri "$Url/rest/v1/$t`?select=*&limit=1" `
      -Headers $Naglowki -Method GET -UseBasicParsing -TimeoutSec 20
    $tresc = $odp.Content
    if ($tresc -eq '[]') {
      Write-Host ("{0,-20} ODCZYT DOZWOLONY (tabela pusta, ale dostep jest!)" -f $t) -ForegroundColor Red
    } else {
      Write-Host ("{0,-20} WYCIEK - zwrocil dane!" -f $t) -ForegroundColor Red
      Write-Host "    $($tresc.Substring(0, [Math]::Min(200, $tresc.Length)))"
    }
    $Wpadki++
  } catch {
    $kod = $_.Exception.Response.StatusCode.value__
    Write-Host ("{0,-20} zablokowane (HTTP {1})" -f $t, $kod) -ForegroundColor Green
  }
}

Write-Host ('-' * 70)

# Sprawdzenie, czy funkcje SQL nie sa wystawione dla anona
$FunkcjeDoSprawdzenia = @('stan_systemu', 'zadanie_retencji', 'zapisz_z_telefonu',
                          'utworz_zaproszenie', 'aktywuj_zaproszenie',
                          'dane_administracyjne', 'admin_przyznaj_dostep',
                          'admin_zablokuj_mechanika')
foreach ($f in $FunkcjeDoSprawdzenia) {
  try {
    Invoke-WebRequest -Uri "$Url/rest/v1/rpc/$f" -Headers $Naglowki -Method POST `
      -Body '{}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 20 | Out-Null
    Write-Host ("rpc/{0,-16} WYWOLYWALNE PRZEZ ANONA!" -f $f) -ForegroundColor Red
    $Wpadki++
  } catch {
    $kod = $_.Exception.Response.StatusCode.value__
    Write-Host ("rpc/{0,-16} zablokowane (HTTP {1})" -f $f, $kod) -ForegroundColor Green
  }
}

Write-Host ('-' * 70)
if ($Wpadki -eq 0) {
  Write-Host 'WYNIK: czysto. Klucz z aplikacji nie widzi zadnych danych.' -ForegroundColor Green
  exit 0
} else {
  Write-Host "WYNIK: $Wpadki PROBLEMOW. Napraw RLS i uprawnienia, zanim wdrozysz." -ForegroundColor Red
  Write-Host 'Sprawdz tez Security Advisor w panelu Supabase.'
  exit 1
}
