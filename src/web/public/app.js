// PDV Agent dashboard: hash-routed single page, no build step.
const app = document.getElementById('app');

// ---------- helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (cents) => `${(cents / 100).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (cents) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + eur(Math.abs(cents));
const hrDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
const periodLabel = (p) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}.`; };
const daysUntil = (iso) => {
  const today = new Date();
  return Math.round((new Date(`${iso}T00:00:00`) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
};

const STATUS = {
  NIJE_POKRENUTO: ['Nije pokrenuto', 'b-grey'],
  CEKA_PREGLED: ['Čeka pregled', 'b-orange'],
  CEKA_KLIJENTA: ['Čeka klijenta', 'b-red'],
  SPREMNO_ZA_PREDAJU: ['Spremno za predaju', 'b-green'],
};
const statusBadge = (s) => { const [t, c] = STATUS[s] ?? [s, 'b-grey']; return `<span class="badge ${c}"><span class="dot"></span>${t}</span>`; };
const SEV = { red: ['Kritično', 'b-red'], orange: ['Provjeriti', 'b-orange'], green: ['Usklađeno', 'b-green'], info: ['Info', 'b-blue'] };
const sevBadge = (s) => { const [t, c] = SEV[s] ?? [s, 'b-grey']; return `<span class="badge ${c}"><span class="dot"></span>${t}</span>`; };
const DECISION = { PILOT: ['Pilot', 'b-accent'], SLJEDECE: ['Sljedeće', 'b-blue'], POMOC: ['AI kao pomoć', 'b-outline'], KASNIJE: ['Kasnije', 'b-grey'] };
const VRSTA = {
  TUZEMNO: 'Tuzemno', EU_USLUGA_PPO: 'EU usluga (PPO)', EU_STJECANJE_DOBARA: 'EU stjecanje dobara',
  EU_USLUGA: 'Usluga u EU', OSLOBODJENO_OSTALO: 'Ostalo oslobođeno', INOZEMNO_BEZ_PDV: 'Inozemno bez PDV-a',
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

// ---------- router ----------

async function route() {
  const [, page, ...rest] = (location.hash || '#/proces').split('/');
  try {
    if (page === 'portfelj') await renderPortfolio();
    else if (page === 'klijent') await renderClient(rest[0], rest[1]);
    else await renderProcess();
  } catch (e) {
    app.innerHTML = `<div class="card card-pad">Greška: ${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

// ---------- 1. process map ----------

async function renderProcess() {
  setNav('proces');
  const m = await api('/api/proces');
  const max = Math.max(...m.poslovi.map((p) => p.satiMjesecno));
  const pilot = m.poslovi.find((p) => p.odluka === 'PILOT');
  app.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Korak 1 · Mapiraj i izmjeri</p>
        <h1>Gdje odlaze sati u računovodstvenom uredu?</h1>
        <p class="lede">Prije bilo kakvog programiranja: popis poslova koji se ponavljaju, koliko često, koliko traju i koliko su podaci spremni za automatizaciju. Prvi pilot je posao koji ima najbolji omjer utjecaja i rizika, ne nužno onaj s najviše sati.</p>
      </div>
    </div>
    <div class="tiles">
      <div class="card tile"><div class="label">Klijenata u uredu</div><div class="value">${m.klijenata}</div><div class="sub">izmišljeni ured</div></div>
      <div class="card tile"><div class="label">Ponavljajući posao</div><div class="value">≈ ${m.ukupnoSatiMjesecno.toLocaleString('hr-HR')} h / mj.</div><div class="sub">zbroj procjena ispod</div></div>
      <div class="card tile emph"><div class="label">Pilot: ${esc(pilot.posao)}</div><div class="value">≈ ${pilot.ustedaSatiMjesecno} h / mj.</div><div class="sub">procjena uštede: ${pilot.minuta} → ${pilot.minutaNakon} min po klijentu</div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Posao</th><th>Učestalost</th><th class="num">Klijenata</th><th class="num">Min / klijent</th><th>Sati mjesečno</th><th>Podaci</th><th>Rizik greške</th><th>Odluka</th></tr></thead>
        <tbody>${m.poslovi.map((p) => `
          <tr class="${p.odluka === 'PILOT' ? 'pilot' : ''}" title="${esc(p.obrazlozenje)}">
            <td class="task"><b>${esc(p.posao)}</b><div class="small muted">${esc(p.obrazlozenje)}</div></td>
            <td>${esc(p.ucestalost)}</td>
            <td class="num">${Math.round(p.udio * 100)} %</td>
            <td class="num">${p.minuta}</td>
            <td class="bar-cell"><div class="bar-row"><div class="bar ${p.odluka === 'PILOT' ? 'pilot' : ''}" style="width:${Math.max(2, (p.satiMjesecno / max) * 140)}px"></div><span class="mono">${p.satiMjesecno} h</span></div></td>
            <td>${esc(p.podaci)}</td>
            <td>${esc(p.rizik)}</td>
            <td><span class="badge ${DECISION[p.odluka][1]}">${DECISION[p.odluka][0]}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <div class="grid-2 section-gap">
      <div class="callout"><b>Zašto PDV usklada prvo</b>
        <p>Rade je svi klijenti svaki mjesec s fiksnim rokom, a greške koštaju. Od Fiskalizacije 2.0 ulazni i izlazni računi su strukturirani podaci. Rezultat se jednostavno provjeri: sustav mora dobiti isto što je računovođa dobio ručno.</p>
      </div>
      <div class="note"><b>Napomena:</b> ${esc(m.napomena)} U stvarnom projektu ove se brojke mjere zajedno s timom prije izrade. Formula: učestalost × udio klijenata × broj klijenata × minute.</div>
    </div>
    <p class="section-gap"><a class="btn btn-primary" href="#/portfelj">Korak 2: Pilot na portfelju klijenata →</a></p>`;
}

// ---------- 2. portfolio ----------

async function renderPortfolio() {
  setNav('portfelj');
  const { ured, klijenti } = await api('/api/ured');
  const open = klijenti.reduce((s, k) => s + (k.otvorene_stavke ?? 0), 0);
  const ready = klijenti.filter((k) => k.status === 'SPREMNO_ZA_PREDAJU').length;
  const rok = klijenti[0]?.rok_prijave;
  app.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Korak 2 · Pilot</p>
        <h1>PDV za ${esc(periodLabel(klijenti[0].period))}</h1>
        <p class="lede">${esc(ured.naziv)} — pregled svih klijenata za razdoblje. Računovođa otvara samo klijente kojima treba pregled.</p>
      </div>
    </div>
    <div class="tiles">
      <div class="card tile"><div class="label">Rok za predaju</div><div class="value">${hrDate(rok)}</div><div class="sub ${daysUntil(rok) <= 7 ? 'deadline soon' : ''}">za ${daysUntil(rok)} dana</div></div>
      <div class="card tile"><div class="label">Spremno za predaju</div><div class="value">${ready} / ${klijenti.length}</div></div>
      <div class="card tile"><div class="label">Otvorene stavke</div><div class="value">${open}</div><div class="sub">za pregled ili od klijenta</div></div>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Klijent</th><th>Djelatnost</th><th>Vlasnik</th><th>Razdoblje</th><th>Status</th><th class="num">Otvorene stavke</th><th></th></tr></thead>
      <tbody>${klijenti.map((k) => `
        <tr class="${k.ima_podatke ? 'clickable' : ''}" ${k.ima_podatke ? `data-href="#/klijent/${esc(k.id)}/${esc(k.period)}"` : ''}>
          <td><b>${esc(k.naziv)}</b><div class="small muted mono">OIB ${esc(k.oib)}</div></td>
          <td>${esc(k.djelatnost)}</td>
          <td class="muted">${esc(k.vlasnik)}</td>
          <td>${esc(periodLabel(k.period))} <span class="small muted">(${esc(k.porezno_razdoblje)})</span></td>
          <td>${statusBadge(k.status)}</td>
          <td class="num">${k.otvorene_stavke ?? '—'}</td>
          <td class="num">${k.ima_podatke ? '<a class="btn btn-sm">Otvori →</a>' : '<span class="small muted">sažetak</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div></div>
    <p class="note section-gap">Za demo su potpuni izvorni dokumenti generirani za Nordtech Adriatic. Ostali klijenti prikazuju samo status.</p>`;
  app.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = tr.dataset.href)));
}

// ---------- 3. client period ----------

let state = null;
let tab = 'nalazi';
let lang = 'hr';

async function renderClient(id, period) {
  setNav('portfelj');
  state = await api(`/api/klijenti/${id}/${period}`);
  drawClient();
}

function drawClient(runlog = '') {
  const s = state;
  const k = s.klijent;
  const days = daysUntil(k.rok_prijave);
  const head = `
    <a class="back" href="#/portfelj">← Portfelj klijenata</a>
    <div class="client-head">
      <div>
        <p class="eyebrow">PDV · ${esc(periodLabel(k.period))}</p>
        <h1>${esc(k.naziv)}</h1>
        <div class="meta"><span class="mono">OIB ${esc(k.oib)}</span><span>${esc(k.djelatnost)}</span><span>Vlasnik: ${esc(k.vlasnik)}</span>
          <span class="deadline ${days <= 7 ? 'soon' : ''}">Rok ${hrDate(k.rok_prijave)} (za ${days} dana)</span></div>
      </div>
      <div style="text-align:right">${statusBadge(k.status)}<div style="margin-top:10px"><button class="btn ${s.run ? '' : 'btn-primary'}" id="run">${s.run ? 'Ponovno pokreni' : 'Pokreni uskladu'}</button></div></div>
    </div>
    ${s.izvori ? `<div class="sources">
      <span class="badge b-outline">${s.izvori.eracuni} eRačuna (XML)</span>
      <span class="badge b-outline">${s.izvori.fiskalizacija} fiskaliziranih zapisa</span>
      <span class="badge b-outline">${s.izvori.pdf} stranih PDF računa${s.izvori.pdf_procitano ? ` · ${s.izvori.pdf_procitano} pročitao AI` : ''}</span>
      <span class="badge b-outline">Knjiga URA ${s.izvori.ura} · IRA ${s.izvori.ira}</span>
      <span class="badge b-outline">Banka ${s.izvori.banka} transakcija</span>
    </div>` : ''}`;

  if (!s.run) {
    app.innerHTML = head + `
      <div class="card empty">
        <h2>Usklada još nije pokrenuta</h2>
        <p>Agent čita strane račune, uspoređuje knjige s fiskaliziranim eRačunima i bankom, primjenjuje PDV pravila te priprema nacrt prijave, objašnjenja i dopis klijentu. Računovođa zatim pregledava samo odstupanja.</p>
        <button class="btn btn-primary" id="run2">Pokreni uskladu</button>
        ${runlog ? `<div class="runlog">${runlog}</div>` : ''}
      </div>`;
    bindRun();
    return;
  }

  const t = s.obrazac;
  const booked = t.prema_knjigama.pdv.za_uplatu;
  const fixed = t.nakon_ispravaka.pdv.za_uplatu;
  const open = s.nalazi.filter((f) => f.status === 'OTVORENO');
  const rows = [...s.ura, ...s.ira];
  const green = rows.filter((r) => r.status === 'green').length;

  app.innerHTML = head + `
    ${runlog ? `<div class="runlog" style="margin-bottom:16px">${runlog}</div>` : ''}
    <div class="tiles">
      <div class="card tile"><div class="label">PDV za uplatu prema knjigama</div><div class="value">${eur(booked)}</div></div>
      <div class="card tile emph"><div class="label">Nakon predloženih ispravaka</div><div class="value">${eur(fixed)}</div><div class="sub">razlika ${signed(fixed - booked)}</div></div>
      <div class="card tile"><div class="label">Otvoreni nalazi</div><div class="value">${open.length} <span class="small muted">/ ${s.nalazi.length}</span></div>
        <div class="sub">${open.filter((f) => f.ozbiljnost === 'red').length} kritično · ${open.filter((f) => f.zahtjev_klijentu).length} čeka klijenta</div></div>
      <div class="card tile"><div class="label">Usklađeni retci u knjigama</div><div class="value">${green} / ${rows.length}</div><div class="sub">bez potrebe za pregledom</div></div>
    </div>
    <div class="tabs">
      ${tabBtn('nalazi', 'Nalazi', s.nalazi.length)}${tabBtn('obrazac', 'Nacrt PDV obrasca')}${tabBtn('knjige', 'Knjige', rows.length)}${tabBtn('banka', 'Banka', s.banka.length)}${tabBtn('dopis', 'Dopis klijentu')}
    </div>
    <div id="tab"></div>`;
  app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; drawClient(); }));
  bindRun();
  drawTab();
}

const tabBtn = (id, label, count) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}${count != null ? `<span class="count">${count}</span>` : ''}</button>`;

function drawTab() {
  const el = document.getElementById('tab');
  if (tab === 'obrazac') el.innerHTML = formHtml();
  else if (tab === 'knjige') el.innerHTML = booksHtml();
  else if (tab === 'banka') el.innerHTML = bankHtml();
  else if (tab === 'dopis') { el.innerHTML = emailHtml(); bindEmail(); }
  else { el.innerHTML = findingsHtml(); bindFindings(); }
}

// ---------- findings ----------

function docLink(d) {
  const base = `/dokumenti/${state.klijent.id}/${state.klijent.period}/`;
  if (d.vrsta === 'eracun' || d.vrsta === 'pdf') return `<a href="${base}${esc(d.datoteka)}" target="_blank" rel="noopener">${d.vrsta === 'pdf' ? 'PDF račun' : 'eRačun XML'}</a>`;
  if (d.vrsta === 'banka') return `<span>Banka ${hrDate(d.datum)} · ${eur(Math.abs(d.iznos))}</span>`;
  if (d.vrsta === 'knjiga') return `<span>Knjiga rb. ${d.rb}</span>`;
  return '';
}

function findingsHtml() {
  if (!state.nalazi.length) return '<div class="card empty"><h2>Nema odstupanja</h2><p>Sve je usklađeno. Prijava je spremna za predaju.</p></div>';
  return `<div class="findings">${state.nalazi.map((f) => {
    const ai = f.ai;
    const done = f.status !== 'OTVORENO';
    return `
    <div class="card finding ${f.ozbiljnost} ${done ? 'done' : ''}">
      <div class="stripe"></div>
      <div class="finding-body">
        <div class="finding-top">
          <div>
            <div class="finding-title">${esc(f.naslov)}</div>
            <div class="finding-sub">${esc(f.partner ?? '')}${f.broj_racuna ? ` · račun ${esc(f.broj_racuna)}` : ''} · ${esc(f.knjiga)}</div>
          </div>
          <div class="finding-effect">${f.utjecaj_za_uplatu ? `<div class="amt ${f.utjecaj_za_uplatu > 0 ? 'diff-pos' : 'diff-neg'}">${signed(f.utjecaj_za_uplatu)}</div><div class="lbl">PDV za uplatu</div>` : '<div class="lbl">bez utjecaja na uplatu</div>'}</div>
        </div>
        ${ai ? `<div class="ai-box"><div class="ai-label">AI objašnjenje</div><p>${esc(ai.objasnjenje)}</p><p class="rec"><b>Preporuka:</b> ${esc(ai.preporuka)}</p></div>` : ''}
        <div class="finding-tags">
          ${sevBadge(f.ozbiljnost)}
          ${f.zahtjev_klijentu ? '<span class="badge b-red">Treba dokument od klijenta</span>' : ''}
          ${ai ? `<span class="badge b-outline">Pravilo ${esc(ai.pravilo_id)}</span><span class="badge b-outline">Sigurnost: ${esc(ai.sigurnost)}</span>` : ''}
          ${ai?.treba_strucnu_provjeru ? '<span class="badge b-orange">Stručna provjera</span>' : ''}
          ${f.dokazi.map(docLink).filter(Boolean).map((l) => `<span class="small">${l}</span>`).join(' · ')}
        </div>
        <details class="sys"><summary>Nalaz sustava (deterministička pravila)</summary><p>${esc(f.detalji)}</p></details>
        <div class="finding-actions">
          <span class="small muted">${done ? (f.status === 'ODOBRENO' ? '✓ Ispravak prihvaćen' : '✕ Nalaz odbačen') : 'Čeka odluku računovođe'}</span>
          <div class="btn-group">${done
            ? `<button class="btn btn-sm" data-act="OTVORENO" data-id="${f.id}">Vrati</button>`
            : `<button class="btn btn-sm" data-act="ODBACENO" data-id="${f.id}">Odbaci</button><button class="btn btn-sm btn-primary" data-act="ODOBRENO" data-id="${f.id}">${f.ispravak ? 'Prihvati ispravak' : 'Riješeno'}</button>`}
          </div>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function bindFindings() {
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    state = await api(`/api/nalazi/${b.dataset.id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: b.dataset.act }),
    });
    drawClient();
  }));
}

// ---------- VAT form ----------

function formHtml() {
  const a = state.obrazac.prema_knjigama.pdv;
  const b = state.obrazac.nakon_ispravaka.pdv;
  const line = (label, get, opts = {}) => {
    const x = get(a), y = get(b), d = y - x;
    return `<tr class="${opts.total ? 'total' : ''}"><td>${label}</td><td class="num">${eur(x)}</td><td class="num">${eur(y)}</td>
      <td class="num ${!d ? 'muted' : opts.total ? (d > 0 ? 'diff-pos' : 'diff-neg') : 'diff'}">${d ? signed(d) : '—'}</td></tr>`;
  };
  const zpA = state.obrazac.prema_knjigama.zp, zpB = state.obrazac.nakon_ispravaka.zp;
  const ids = [...new Set([...zpA, ...zpB].map((z) => z.vat_id))];
  const zp = (list, id) => list.find((z) => z.vat_id === id)?.usluge ?? 0;
  return `
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Stavka</th><th class="num">Prema knjigama</th><th class="num">Nakon ispravaka</th><th class="num">Razlika</th></tr></thead>
      <tbody>
        <tr><td colspan="4" class="small muted"><b>Isporuke</b></td></tr>
        ${line('Isporuke u RH 25 % — osnovica', (t) => t.isporuke_tuzemne_25.osnovica)}
        ${line('Isporuke u RH 25 % — PDV', (t) => t.isporuke_tuzemne_25.pdv)}
        ${line('Usluge obavljene u EU (bez PDV-a)', (t) => t.usluge_u_eu.osnovica)}
        ${line('Ostale oslobođene isporuke', (t) => t.ostale_oslobodjene.osnovica)}
        <tr><td colspan="4" class="small muted"><b>Prijenos porezne obveze (EU)</b></td></tr>
        ${line('Primljene usluge iz EU 25 % — osnovica', (t) => t.primljene_usluge_eu_25.osnovica)}
        ${line('Primljene usluge iz EU 25 % — PDV', (t) => t.primljene_usluge_eu_25.pdv)}
        ${line('Stjecanje dobara iz EU 25 % — osnovica', (t) => t.stjecanje_dobara_eu_25.osnovica)}
        ${line('Stjecanje dobara iz EU 25 % — PDV', (t) => t.stjecanje_dobara_eu_25.pdv)}
        <tr><td colspan="4" class="small muted"><b>Pretporez</b></td></tr>
        ${line('Pretporez — tuzemni 25 %', (t) => t.pretporez_tuzemni['25'] ?? 0)}
        ${line('Pretporez — tuzemni 13 %', (t) => t.pretporez_tuzemni['13'] ?? 0)}
        ${line('Pretporez — primljene usluge iz EU', (t) => t.pretporez_eu_usluge)}
        ${line('Pretporez — stjecanje dobara iz EU', (t) => t.pretporez_eu_stjecanje)}
        ${line('Ukupna porezna obveza', (t) => t.ukupna_obveza, { total: true })}
        ${line('Ukupni pretporez', (t) => t.ukupni_pretporez, { total: true })}
        ${line('PDV za uplatu', (t) => t.za_uplatu, { total: true })}
      </tbody>
    </table></div></div>
    <div class="card section-gap"><div class="card-pad"><h2>Zbirna prijava (obrazac ZP) — usluge</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>PDV ID kupca</th><th class="num">Prema knjigama</th><th class="num">Nakon ispravaka</th></tr></thead>
        <tbody>${ids.map((id) => `<tr><td class="mono">${esc(id)}</td><td class="num">${eur(zp(zpA, id))}</td><td class="num">${eur(zp(zpB, id))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nema</td></tr>'}</tbody>
      </table></div></div>
    <p class="note section-gap">Pojednostavljeni prikaz grupiran po značenju. Mapiranje na službene retke obrasca PDV i PDV-S mora provjeriti porezni stručnjak. "Nakon ispravaka" uključuje sve ispravke koje računovođa nije odbacio.</p>`;
}

// ---------- books & bank ----------

function booksHtml() {
  const table = (title, rows, ura) => `
    <div class="card section-gap"><div class="card-pad"><h2>${title}</h2></div><div class="table-wrap"><table>
      <thead><tr><th></th><th class="num">Rb.</th><th>Račun</th><th>Datum</th><th>Partner</th><th>Vrsta</th><th class="num">Osnovica</th><th class="num">PDV</th>${ura ? '<th class="num">Pretporez</th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${sevBadge(r.status)}</td><td class="num">${r.rb}</td><td class="mono">${esc(r.broj_racuna)}</td><td>${hrDate(r.datum_racuna)}</td>
        <td>${esc(r.partner)}<div class="small muted">${esc(r.opis ?? '')}</div></td><td class="small">${esc(VRSTA[r.vrsta] ?? r.vrsta)}</td>
        <td class="num">${eur(r.osnovica)}</td><td class="num">${eur(r.pdv)}</td>${ura ? `<td class="num">${eur(r.pretporez)}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>`;
  return `<p class="note">Status retka prema pravilima usklade. Zeleni retci odgovaraju eRačunu, računu i banci te ne trebaju pregled.</p>
    ${table('Knjiga ulaznih računa (URA)', state.ura, true)}${table('Knjiga izlaznih računa (IRA)', state.ira, false)}`;
}

function bankHtml() {
  return `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th></th><th>Datum</th><th>Opis</th><th>Protustrana</th><th>Uparivanje</th><th class="num">Iznos</th></tr></thead>
    <tbody>${state.banka.map((t) => `<tr>
      <td>${sevBadge(t.status)}</td><td>${hrDate(t.datum)}</td><td>${esc(t.opis)}</td><td>${esc(t.protustrana)}</td>
      <td class="small">${esc(t.kategorija)}${t.racun ? ` · <span class="mono">${esc(t.racun)}</span>` : ''}</td>
      <td class="num ${t.iznos < 0 ? '' : 'diff-neg'}">${t.iznos < 0 ? '−' : '+'}${eur(Math.abs(t.iznos))}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// ---------- client email ----------

function emailHtml() {
  const d = state.dopis;
  if (!d) return '<div class="card empty"><h2>Nema zahtjeva prema klijentu</h2><p>Za ovo razdoblje od klijenta ne treba ništa.</p></div>';
  const subject = lang === 'hr' ? d.hr_predmet : d.en_predmet;
  const body = lang === 'hr' ? d.hr_tijelo : d.en_tijelo;
  return `
    <div class="email-head">
      <div class="btn-group"><button class="btn btn-sm ${lang === 'hr' ? 'btn-primary' : ''}" data-lang="hr">Hrvatski</button><button class="btn btn-sm ${lang === 'en' ? 'btn-primary' : ''}" data-lang="en">English</button></div>
      <button class="btn btn-sm" id="copy">Kopiraj tekst</button>
    </div>
    <div class="email"><div class="subject">${esc(subject)}</div><pre>${esc(body)}</pre></div>
    <p class="note section-gap">Nacrt je napisao AI iz nalaza koji traže dokument od klijenta. Ništa se ne šalje automatski: računovođa pregledava i šalje iz svoje pošte.</p>`;
}

function bindEmail() {
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; drawTab(); }));
  document.getElementById('copy')?.addEventListener('click', async (e) => {
    const d = state.dopis;
    await navigator.clipboard.writeText(`${lang === 'hr' ? d.hr_predmet : d.en_predmet}\n\n${lang === 'hr' ? d.hr_tijelo : d.en_tijelo}`);
    e.target.textContent = 'Kopirano ✓';
  });
}

// ---------- run ----------

function bindRun() {
  for (const id of ['run', 'run2']) document.getElementById(id)?.addEventListener('click', runAgent);
}

async function runAgent() {
  const { id, period } = state.klijent;
  let log = '';
  const push = (line, warn) => { log += warn ? `<span class="warn">${esc(line)}</span>\n` : `${esc(line)}\n`; drawClient(log); setRunning(); };
  const setRunning = () => document.querySelectorAll('#run, #run2').forEach((b) => { b.disabled = true; b.textContent = 'Agent radi…'; });
  push('Pokrećem agenta…');
  const res = await fetch(`/api/klijenti/${id}/${period}/pokreni`, { method: 'POST' });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines.filter(Boolean)) {
      const m = JSON.parse(l);
      if (m.tip === 'log') push(m.tekst);
      if (m.tip === 'upozorenje') push(m.tekst, true);
    }
  }
  push('Gotovo.');
  state = await api(`/api/klijenti/${id}/${period}`);
  tab = 'nalazi';
  drawClient(log);
}
