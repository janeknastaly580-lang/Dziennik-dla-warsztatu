/**
 * Panel administratora systemu warsztatu.
 *
 * Dane NIE przechodza juz przez ten serwer - telefony rozmawiaja bezposrednio
 * z Supabase przez Edge Functions. Ten proces sluzy wylacznie administratorowi:
 * przyznaje i odbiera dostep mechanikom, pokazuje kwarantanne, duplikaty
 * i dziennik dostepu.
 *
 * A2: nasluchuje domyslnie na 127.0.0.1, bo trzyma klucz service_role.
 *     Nie wystawiaj go do sieci warsztatu ani tym bardziej do internetu.
 *
 * Uruchomienie:  npm start   (w katalogu backend)
 */
import express from 'express';

import {
  PORT, HOST, SUPABASE_URL, KATALOG_PUBLICZNY, brakiKonfiguracji, NAZWA_ADMINISTRATORA,
} from './config.js';
import { BladHttp, bezDanychOsobowych } from './pomocnicze.js';
import { BladSupabase, sprawdzPolaczenie } from './supabase.js';
import trasyAdmin, { wymagajLogowania } from './routes/admin.js';

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));

// A11: log bez danych osobowych - sama metoda i sciezka, nigdy tresc zadania.
app.use((req, _res, next) => {
  const czas = new Date().toLocaleTimeString('pl-PL');
  console.log(`[${czas}] ${req.method} ${req.path}`);
  next();
});

/** Panel jest statyczna strona - zadnych danych bez zalogowania. */
app.use('/', express.static(KATALOG_PUBLICZNY, { index: 'index.html' }));

/** GET /api/health - dziala bez logowania, ale nie zdradza zawartosci bazy. */
app.get('/api/health', (_req, res) => {
  const braki = brakiKonfiguracji();
  res.json({
    ok: braki.length === 0,
    usluga: 'panel-administratora-warsztatu',
    wersja: '2.0.0',
    czas: new Date().toISOString(),
    supabase: SUPABASE_URL || '(nie ustawiono)',
    braki_konfiguracji: braki,
  });
});

app.use('/api', trasyAdmin);

app.use('/api', (req, res) => {
  res.status(404).json({ blad: `Nieznany endpoint: ${req.method} ${req.path}` });
});

// Centralna obsluga bledow - zawsze JSON, nigdy stos wywolan do przegladarki.
app.use((err, _req, res, _next) => {
  if (err instanceof BladHttp) {
    return res.status(err.status).json({ blad: err.message, szczegoly: err.szczegoly });
  }
  if (err instanceof BladSupabase) {
    console.error('Blad Supabase:', err.message);
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 502)
      .json({ blad: err.message });
  }
  console.error('Blad serwera:', bezDanychOsobowych({ komunikat: String(err?.message) }));
  return res.status(500).json({ blad: 'Wewnetrzny blad serwera' });
});

const serwer = app.listen(PORT, HOST, async () => {
  const braki = brakiKonfiguracji();
  console.log('');
  console.log('==============================================================');
  console.log('  WARSZTAT - panel administratora');
  console.log('==============================================================');
  console.log(`  Panel        : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Supabase     : ${SUPABASE_URL || '(BRAK - uzupelnij backend/.env)'}`);
  console.log(`  Administrator: ${NAZWA_ADMINISTRATORA}`);

  if (braki.length) {
    console.log('--------------------------------------------------------------');
    console.log('  BRAKUJE W backend/.env:');
    for (const b of braki) console.log(`    - ${b}`);
    console.log('  Wzor: backend/.env.example');
  } else {
    try {
      const stan = await sprawdzPolaczenie();
      console.log('--------------------------------------------------------------');
      console.log(`  Polaczenie z baza OK. Warsztaty: ${stan.warsztaty}, `
        + `mechanicy: ${stan.mechanicy}, urzadzenia: ${stan.urzadzenia}`);
      if (stan.kwarantanna > 0) {
        console.log(`  UWAGA: ${stan.kwarantanna} wpisow czeka w kwarantannie (B8).`);
      }
      if (stan.milczace_urzadzenia > 0) {
        console.log(`  UWAGA: ${stan.milczace_urzadzenia} telefonow nie synchronizowalo sie od doby.`);
      }
    } catch (err) {
      console.log('--------------------------------------------------------------');
      console.log(`  NIE UDALO SIE POLACZYC Z BAZA: ${err.message}`);
    }
  }

  if (HOST === '0.0.0.0') {
    console.log('--------------------------------------------------------------');
    console.log('  OSTRZEZENIE: HOST=0.0.0.0 wystawia panel na cala siec.');
    console.log('  Za panelem stoi klucz service_role omijajacy RLS - zostaw 127.0.0.1.');
  }
  console.log('==============================================================');
  console.log('');
});

const zamknij = () => {
  console.log('\nZamykanie panelu...');
  serwer.close(() => process.exit(0));
};
process.on('SIGINT', zamknij);
process.on('SIGTERM', zamknij);

export default app;
