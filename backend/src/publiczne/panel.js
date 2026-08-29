/**
 * Panel administratora - warstwa przegladarki.
 *
 * Panel nie zna zadnego klucza do Supabase. Rozmawia wylacznie z lokalnym
 * serwerem panelu, ktory dopiero on uzywa klucza service_role (A2).
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let warsztaty = [];
let mechanicy = [];

/* ------------------------------ pomocnicze ------------------------------ */

async function api(sciezka, opcje = {}) {
  const odp = await fetch(`/api${sciezka}`, {
    method: opcje.metoda ?? 'GET',
    headers: opcje.cialo ? { 'Content-Type': 'application/json' } : undefined,
    body: opcje.cialo ? JSON.stringify(opcje.cialo) : undefined,
  });
  const dane = await odp.json().catch(() => null);
  if (odp.status === 401 && sciezka !== '/logowanie') {
    pokazLogowanie();
    throw new Error('Sesja wygasla - zaloguj sie ponownie');
  }
  if (!odp.ok) throw new Error(dane?.blad ?? `Blad ${odp.status}`);
  return dane;
}

function komunikat(tresc, zly = false) {
  const el = $('#komunikat');
  el.textContent = tresc;
  el.classList.toggle('zly', zly);
  el.hidden = !tresc;
  if (tresc && !zly) setTimeout(() => { el.hidden = true; }, 6000);
}

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));

function czas(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

async function sprobuj(fn, komunikatSukcesu) {
  try {
    await fn();
    if (komunikatSukcesu) komunikat(komunikatSukcesu);
  } catch (err) {
    komunikat(err.message, true);
  }
}

/* ------------------------------- logowanie ------------------------------ */

function pokazLogowanie() {
  $('#logowanie').hidden = false;
  $('#panel').hidden = true;
}

function pokazPanel() {
  $('#logowanie').hidden = true;
  $('#panel').hidden = false;
  odswiezWszystko();
}

$('#formLogowania').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#bladLogowania').textContent = '';
  try {
    await api('/logowanie', { metoda: 'POST', cialo: { haslo: $('#haslo').value } });
    $('#haslo').value = '';
    pokazPanel();
  } catch (err) {
    $('#bladLogowania').textContent = err.message;
  }
});

$('#wyloguj').addEventListener('click', async () => {
  await api('/wyloguj', { metoda: 'POST' }).catch(() => {});
  pokazLogowanie();
});

/* ------------------------------- zakladki ------------------------------- */

$$('header nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('header nav button').forEach((b) => b.classList.toggle('aktywna', b === btn));
    const nazwa = btn.dataset.zakladka;
    $$('section[data-sekcja]').forEach((s) => { s.hidden = s.dataset.sekcja !== nazwa; });
    odswiezWszystko();
  });
});

/* --------------------------------- STAN --------------------------------- */

async function wczytajStan() {
  const { stan, urzadzenia } = await api('/stan');

  const kafelek = (liczba, opis, alarm = false) =>
    `<div class="kafelek ${alarm && liczba > 0 ? 'alarm' : ''}">
       <div class="liczba">${liczba}</div><div class="opis">${opis}</div></div>`;

  $('#kafelki').innerHTML = [
    kafelek(stan.klienci, 'kartotek klientow'),
    kafelek(stan.wizyty, 'wizyt w bazie'),
    kafelek(stan.otwarte, 'otwartych usterek'),
    kafelek(stan.urzadzenia, 'aktywnych telefonow'),
    kafelek(stan.oczekujace_kody, 'czeka na dostep'),
    kafelek(stan.zablokowani, 'zablokowanych kont', true),
    kafelek(stan.kwarantanna, 'w kwarantannie (B8)', true),
    kafelek(stan.duplikaty, 'mozliwych duplikatow', true),
    kafelek(stan.milczace_urzadzenia, 'telefonow bez sync > 24 h', true),
  ].join('');

  $('#odznakaKwarantanna').textContent = stan.kwarantanna || '';
  $('#odznakaKwarantanna').classList.toggle('widoczna', stan.kwarantanna > 0);
  $('#odznakaDuplikaty').textContent = stan.duplikaty || '';
  $('#odznakaDuplikaty').classList.toggle('widoczna', stan.duplikaty > 0);

  const cialo = $('#tabelaUrzadzen tbody');
  cialo.innerHTML = urzadzenia.length ? urzadzenia.map((u) => {
    const godzin = Number(u.godzin_bez_sync ?? 0);
    const klasa = u.zablokowane ? 'stan-zly' : godzin > 24 ? 'stan-uwaga' : 'stan-ok';
    const opis = u.zablokowane ? 'zablokowane' : godzin > 24 ? 'milczy' : 'w porzadku';
    return `<tr>
      <td>${esc(u.mechanik)}</td>
      <td>${esc(u.platforma ?? '-')}</td>
      <td>${esc(u.wersja_aplikacji ?? '-')}</td>
      <td>${czas(u.ostatnia_sync_o)}</td>
      <td class="${godzin > 24 ? 'stan-uwaga' : ''}">${godzin}</td>
      <td class="${u.w_kwarantannie > 0 ? 'stan-zly' : ''}">${u.w_kwarantannie}</td>
      <td class="${klasa}">${opis}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="pusto">Zaden telefon nie jest jeszcze sparowany.</td></tr>';
}

/* -------------------------------- DOSTEP -------------------------------- */

async function wczytajDostep() {
  [warsztaty, mechanicy] = await Promise.all([api('/warsztaty'), api('/mechanicy')]);
  const oczekujace = await api('/urzadzenia/oczekujace');

  $('#wyborMechanika').innerHTML = mechanicy.length
    ? mechanicy.map((m) => `<option value="${m.id}">${esc(m.imie)}</option>`).join('')
    : '<option value="">(najpierw dodaj mechanika)</option>';
  $('#wyborWarsztatu').innerHTML = warsztaty
    .map((w) => `<option value="${w.id}">${esc(w.nazwa)}</option>`).join('');

  $('#tabelaOczekujacych tbody').innerHTML = oczekujace.length
    ? oczekujace.map((u) => `<tr>
        <td class="kod">${esc(u.kod_parowania)}</td>
        <td>${esc(u.nazwa_urzadzenia ?? '-')} (${esc(u.platforma ?? '?')}, ${esc(u.wersja_aplikacji ?? '?')})</td>
        <td>${czas(u.utworzono)}</td>
        <td>${czas(u.kod_wygasa_o)}</td>
        <td><button data-kod="${esc(u.kod_parowania)}" class="wstawKod drugi">Wpisz ponizej</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="pusto">Zaden telefon nie czeka na dostep.</td></tr>';

  $$('.wstawKod').forEach((b) => b.addEventListener('click', () => {
    $('#kodParowania').value = b.dataset.kod;
    $('#wyborMechanika').focus();
  }));

  $('#listaMechanikow').innerHTML = mechanicy.length ? mechanicy.map((m) => {
    const warsztat = warsztaty.find((w) => w.id === m.warsztat_id);
    const urzadzenia = m.urzadzenia ?? [];
    return `<div class="karta ${m.zablokowany_o ? 'zablokowany' : ''}">
      <div class="naglowek">
        <div>
          <div class="tytul">${esc(m.imie)}</div>
          <div class="drobne" style="margin:0">
            ${esc(warsztat?.nazwa ?? 'brak warsztatu')} ·
            ${m.zablokowany_o
              ? `<span class="stan-zly">ZABLOKOWANY: ${esc(m.powod_blokady ?? '')}</span>`
              : '<span class="stan-ok">aktywny</span>'} ·
            telefonow: ${urzadzenia.length}
          </div>
        </div>
        <div class="akcje">
          ${m.zablokowany_o
            ? `<button class="odblokujMechanika drugi" data-id="${m.id}">Odblokuj</button>`
            : `<button class="zablokujMechanika niebezpieczny" data-id="${m.id}">Zablokuj dostep</button>`}
        </div>
      </div>
      ${urzadzenia.map((u) => `<div class="naglowek" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--obramowanie)">
        <div class="drobne" style="margin:0">
          ${esc(u.nazwa_urzadzenia ?? 'telefon')} (${esc(u.platforma ?? '?')}) ·
          ostatnia sync: ${czas(u.ostatnia_sync_o)}
          ${u.zablokowane_o ? ' · <span class="stan-zly">zablokowane</span>' : ''}
          ${u.zadanie_resetu_hasla_o ? ' · <span class="stan-uwaga">czeka na ustawienie hasla</span>' : ''}
        </div>
        <div class="akcje">
          <button class="resetHasla drugi" data-id="${u.id}">Kaz ustawic nowe haslo</button>
          ${u.zablokowane_o
            ? `<button class="odblokujUrzadzenie drugi" data-id="${u.id}">Odblokuj telefon</button>`
            : `<button class="zablokujUrzadzenie niebezpieczny" data-id="${u.id}">Zablokuj telefon</button>`}
          <button class="wyrejestruj niebezpieczny" data-id="${u.id}">Wyrejestruj (zgubiony)</button>
        </div>
      </div>`).join('')}
    </div>`;
  }).join('') : '<p class="drobne">Nie ma jeszcze zadnego mechanika.</p>';

  const akcja = (klasa, sciezka, pytanie, sukces) => {
    $$(`.${klasa}`).forEach((b) => b.addEventListener('click', () => {
      if (pytanie && !confirm(pytanie)) return;
      sprobuj(async () => {
        await api(sciezka(b.dataset.id), { metoda: 'POST', cialo: {} });
        await wczytajDostep();
      }, sukces);
    }));
  };

  akcja('zablokujMechanika', (id) => `/mechanicy/${id}/zablokuj`,
    'Zablokowac dostep temu mechanikowi? Wszystkie jego telefony przestana dzialac '
    + 'i przy najblizszym polaczeniu skasuja lokalna baze.',
    'Dostep zablokowany.');
  akcja('odblokujMechanika', (id) => `/mechanicy/${id}/odblokuj`, null, 'Dostep przywrocony.');
  akcja('zablokujUrzadzenie', (id) => `/urzadzenia/${id}/zablokuj`,
    'Zablokowac ten telefon i kazac mu wyczyscic dane?', 'Telefon zablokowany.');
  akcja('odblokujUrzadzenie', (id) => `/urzadzenia/${id}/odblokuj`, null, 'Telefon odblokowany.');
  akcja('wyrejestruj', (id) => `/urzadzenia/${id}/wyrejestruj`,
    'Wyrejestrowac telefon na stale? Zeby wrocic, bedzie musial przejsc parowanie od nowa.',
    'Telefon wyrejestrowany.');
  akcja('resetHasla', (id) => `/urzadzenia/${id}/reset-hasla`, null,
    'Przy najblizszym uruchomieniu aplikacja poprosi o ustawienie nowego hasla.');
}

$('#formPrzyznania').addEventListener('submit', (e) => {
  e.preventDefault();
  sprobuj(async () => {
    await api('/urzadzenia/przyznaj', {
      metoda: 'POST',
      cialo: { kod: $('#kodParowania').value, mechanik_id: $('#wyborMechanika').value },
    });
    $('#kodParowania').value = '';
    await wczytajDostep();
  }, 'Dostep przyznany. Telefon odbierze go w ciagu kilku sekund.');
});

$('#formMechanika').addEventListener('submit', (e) => {
  e.preventDefault();
  sprobuj(async () => {
    await api('/mechanicy', {
      metoda: 'POST',
      cialo: { imie: $('#imieMechanika').value, warsztat_id: $('#wyborWarsztatu').value },
    });
    $('#imieMechanika').value = '';
    await wczytajDostep();
  }, 'Mechanik dodany.');
});

/* ----------------------------- KWARANTANNA ------------------------------ */

async function wczytajKwarantanne() {
  const wpisy = await api('/kwarantanna');
  $('#listaKwarantanny').innerHTML = wpisy.length ? wpisy.map((w) => `
    <div class="karta">
      <div class="naglowek">
        <div>
          <div class="tytul">${esc(w.tabela)} · ${esc(w.operacja)}</div>
          <div class="drobne" style="margin:0">${czas(w.przyjete_o)} · rekord ${esc(w.rekord_id ?? '-')}</div>
        </div>
        <div class="akcje">
          <button class="rozwiazKwarantanne drugi" data-id="${w.id}">Oznacz jako zalatwione</button>
        </div>
      </div>
      <p class="stan-zly" style="margin:8px 0 4px">${esc(w.blad)}</p>
      <pre class="wynik">${esc(JSON.stringify(w.ladunek, null, 1))}</pre>
    </div>`).join('')
    : '<p class="drobne">Kwarantanna jest pusta - wszystkie zapisy z telefonow zostaly przyjete.</p>';

  $$('.rozwiazKwarantanne').forEach((b) => b.addEventListener('click', () => sprobuj(async () => {
    await api(`/kwarantanna/${b.dataset.id}/rozwiaz`, { metoda: 'POST', cialo: {} });
    await wczytajKwarantanne();
  }, 'Wpis zamkniety.')));
}

/* ------------------------------ DUPLIKATY ------------------------------- */

async function wczytajDuplikaty() {
  const { duplikaty, klienci, wizyty } = await api('/duplikaty');
  const opis = (tabela, id) => {
    if (tabela === 'klienci') {
      const k = klienci.find((x) => x.id === id);
      return k ? `${esc(k.nazwa)} · ${esc(k.telefon ?? 'bez telefonu')}` : esc(id);
    }
    const w = wizyty.find((x) => x.id === id);
    return w ? `${esc(w.tytul)} · ${esc(w.auto ?? 'bez auta')} · ${esc(w.data_wizyty)}` : esc(id);
  };

  $('#listaDuplikatow').innerHTML = duplikaty.length ? duplikaty.map((d) => `
    <div class="karta">
      <div class="naglowek">
        <div>
          <div class="tytul">${esc(d.tabela)} · ${esc(d.powod)}</div>
          <div class="drobne" style="margin:6px 0 0">
            nowy:  ${opis(d.tabela, d.rekord_id)}<br>
            stary: ${opis(d.tabela, d.podobny_do)}
          </div>
        </div>
        <div class="akcje">
          <button class="rozwiazDuplikat drugi" data-id="${d.id}">To nie duplikat</button>
        </div>
      </div>
    </div>`).join('')
    : '<p class="drobne">Nie wykryto zadnych podejrzanych par.</p>';

  $$('.rozwiazDuplikat').forEach((b) => b.addEventListener('click', () => sprobuj(async () => {
    await api(`/duplikaty/${b.dataset.id}/rozwiaz`, { metoda: 'POST', cialo: {} });
    await wczytajDuplikaty();
  }, 'Oznaczono jako rozwiazane.')));
}

/* ------------------------------- DZIENNIK ------------------------------- */

async function wczytajDziennik() {
  const [{ wpisy, mechanicy: lista }, admin] = await Promise.all([
    api('/dziennik'), api('/dziennik-admina'),
  ]);
  const imie = (id) => lista.find((m) => m.id === id)?.imie ?? '-';

  $('#tabelaDziennika tbody').innerHTML = wpisy.length ? wpisy.map((w) => `<tr>
      <td>${czas(w.kiedy)}</td><td>${esc(imie(w.mechanik_id))}</td>
      <td>${esc(w.akcja)}</td><td>${esc(w.klient_id ?? '-')}</td><td>${esc(w.wizyta_id ?? '-')}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="pusto">Dziennik jest pusty.</td></tr>';

  $('#tabelaDziennikaAdmina tbody').innerHTML = admin.length ? admin.map((w) => `<tr>
      <td>${czas(w.kiedy)}</td><td>${esc(w.kto)}</td><td>${esc(w.akcja)}</td>
      <td><code>${esc(JSON.stringify(w.szczegoly))}</code></td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="pusto">Brak wpisow.</td></tr>';
}

/* ------------------------------ USTAWIENIA ------------------------------ */

async function wczytajUstawienia() {
  warsztaty = await api('/warsztaty');
  $('#listaWarsztatow').innerHTML = warsztaty.map((w) => `
    <div class="karta">
      <div class="tytul">${esc(w.nazwa)} <span class="drobne">prefiks ${esc(w.prefiks)}</span></div>
      <div class="pola-warsztatu">
        <div><label>Okno synchronizacji (dni)</label>
          <input type="number" min="7" max="3650" value="${w.okno_dni}" data-pole="okno_dni" data-id="${w.id}"></div>
        <div><label>Retencja usunietych (dni)</label>
          <input type="number" min="30" max="3650" value="${w.retencja_dni}" data-pole="retencja_dni" data-id="${w.id}"></div>
        <div><label>Wygasniecie offline (dni)</label>
          <input type="number" min="1" max="90" value="${w.wygasniecie_offline_dni}" data-pole="wygasniecie_offline_dni" data-id="${w.id}"></div>
        <button class="zapiszWarsztat" data-id="${w.id}">Zapisz</button>
      </div>
    </div>`).join('');

  $$('.zapiszWarsztat').forEach((b) => b.addEventListener('click', () => sprobuj(async () => {
    const id = b.dataset.id;
    const cialo = {};
    $$(`input[data-id="${id}"]`).forEach((i) => { cialo[i.dataset.pole] = Number(i.value); });
    await api(`/warsztaty/${id}`, { metoda: 'PATCH', cialo });
  }, 'Ustawienia warsztatu zapisane. Telefony przyjma je przy najblizszej synchronizacji.')));
}

$('#formWarsztatu').addEventListener('submit', (e) => {
  e.preventDefault();
  sprobuj(async () => {
    await api('/warsztaty', {
      metoda: 'POST',
      cialo: { nazwa: $('#nazwaWarsztatu').value, prefiks: $('#prefiksWarsztatu').value },
    });
    $('#nazwaWarsztatu').value = '';
    $('#prefiksWarsztatu').value = '';
    await wczytajUstawienia();
  }, 'Warsztat dodany.');
});

$('#uruchomRetencje').addEventListener('click', () => sprobuj(async () => {
  const wynik = await api('/retencja', { metoda: 'POST', cialo: {} });
  $('#wynikRetencji').textContent = JSON.stringify(wynik, null, 2);
  $('#wynikRetencji').hidden = false;
}, 'Retencja wykonana.'));

/* ------------------------------ odswiezanie ----------------------------- */

const WCZYTYWANIE = {
  stan: wczytajStan,
  dostep: wczytajDostep,
  kwarantanna: wczytajKwarantanne,
  duplikaty: wczytajDuplikaty,
  dziennik: wczytajDziennik,
  ustawienia: wczytajUstawienia,
};

function aktywnaZakladka() {
  return $('header nav button.aktywna')?.dataset.zakladka ?? 'stan';
}

async function odswiezWszystko() {
  try {
    await WCZYTYWANIE[aktywnaZakladka()]();
    // Odznaki przy zakladkach maja byc aktualne niezaleznie od tego,
    // ktora zakladka jest otwarta.
    if (aktywnaZakladka() !== 'stan') await wczytajStan().catch(() => {});
  } catch (err) {
    komunikat(err.message, true);
  }
}

// Telefony czekajace na dostep pojawiaja sie w tle - panel sam sie odswieza.
setInterval(() => { if (!$('#panel').hidden) odswiezWszystko(); }, 15000);

/* --------------------------------- start -------------------------------- */

(async () => {
  try {
    await api('/stan');
    pokazPanel();
  } catch {
    pokazLogowanie();
  }
})();
