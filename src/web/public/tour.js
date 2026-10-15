// Guided tour through the real demo, focused on one message: time and money saved.
// Drives the app through the DOM only (hash navigation and button clicks), so it shows
// exactly what a user would see.

const CLIENT = '#/klijent/nordtech-adriatic/2026-09';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const isPhone = () => window.innerWidth < 700;

async function waitFor(fn, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(120);
  }
}

async function go(hash, ready) {
  if (location.hash !== hash) location.hash = hash;
  await waitFor(() => $(ready));
  await sleep(150);
}

async function openTab(name, ready) {
  await go(CLIENT, '.tabs');
  const b = $(`.tabs button[data-tab="${name}"]`);
  if (b && !b.classList.contains('active')) b.click();
  await waitFor(() => $(ready));
}

// Makes sure the client period has a finished run (the public demo may start from a fresh database).
async function ensureRun() {
  await go(CLIENT, '#run, #run2');
  if (!$('.tiles')) {
    ($('#run2') || $('#run')).click();
    await waitFor(() => $('.tiles') && !$('#run[disabled], #run2[disabled]'), 60000);
  }
}

// Each step: a big headline number (kpi), a short title and one or two plain sentences.
const STEPS = [
  {
    center: true,
    kpi: '20+ sati tjedno',
    title: 'Toliko računovođe troše na ručno slaganje dokumentacije',
    text: 'Izmjerio je to britanski ured Thomas & Co za svojih 25 računovođa. Ovaj obilazak pokazuje kako AI agent preuzima takav posao, na primjeru mjesečne PDV prijave.',
    async before() { await go('#/proces', 'tr.pilot'); },
  },
  {
    target: 'tr.pilot',
    kpi: '≈ 120 sati mjesečno',
    title: 'PDV prijava: oko 60 minuta po klijentu',
    text: 'Svaki klijent, svaki mjesec. U uredu sa 120 klijenata to je oko 120 sati ručnog uspoređivanja.',
    async before() { await go('#/proces', 'tr.pilot'); },
  },
  {
    target: '.tile.emph',
    kpi: '60 → 15 minuta',
    title: 'S agentom ostaje samo pregled',
    text: 'Agent sve usporedi sam, a računovođa pregleda samo ono što ne štima. To je oko 90 sati manje svaki mjesec.',
    async before() { await go('#/proces', '.tile.emph'); },
  },
  {
    target: 'tr[data-href]',
    kpi: 'Cijeli ured u jednom pogledu',
    title: 'Odmah znate gdje je potreban pregled',
    text: 'Rok, status i otvorene stavke za svakog klijenta. Klijenti kod kojih je sve u redu ne oduzimaju vrijeme.',
    async before() { await go('#/portfelj', 'tr[data-href]'); },
  },
  {
    target: '.sources',
    kpi: '86 dokumenata u nekoliko sekundi',
    title: 'Agent pregleda sve umjesto računovođe',
    text: 'eRačune, strane PDF račune, knjige računa i bankovni izvod. Sve usporedi i primijeni PDV pravila.',
    async before() { await ensureRun(); },
  },
  {
    target: '.tiles .tile:nth-child(2)',
    kpi: '1.126,63 €',
    title: 'Pronađena greška u PDV prijavi',
    text: 'Prema knjigama klijent bi platio 7.235,34 €, a točno je 8.361,97 €. Bez provjere ured bi predao netočnu prijavu, s rizikom kamata i kazne.',
    async before() { await ensureRun(); },
  },
  {
    target: '.tiles .tile:nth-child(4)',
    kpi: '8 od 30',
    title: 'Pregledava se samo ono što treba',
    text: '22 knjiženja agent je potvrdio sam. Računovođa provjerava samo 8 spornih, plus 2 stavke koje u knjigama nedostaju: neproknjiženi eRačun i plaćanje bez računa.',
    async before() { await ensureRun(); },
  },
  {
    target: '.finding',
    kpi: 'Odluka ostaje računovođi',
    title: 'Svaki nalaz je objašnjen',
    text: 'Što je krivo, koje pravilo vrijedi i koliko to mijenja PDV. Iznose računa program, točno do centa. Računovođa samo prihvati ili odbaci.',
    async before() { await openTab('nalazi', '.finding'); },
  },
  {
    target: '.msg-a',
    kpi: 'Odgovor u sekundi',
    title: 'Umjesto traženja po papirima: pitajte agenta',
    text: '"Što još trebam od klijenta?" Agent odgovara iz nalaza i PDV pravila, s poveznicama na svaki nalaz.',
    async before() {
      await openTab('agent', '[data-q]');
      if (!$('.msg-a')) $('[data-q]').click();
      await waitFor(() => $('.msg-a') && !$('.msg-a .muted'), 30000);
    },
  },
  {
    target: '.email',
    kpi: 'Spremno za slanje',
    title: 'Dopis klijentu je već napisan',
    text: 'Popis dokumenata koji nedostaju, na hrvatskom ili engleskom.',
    async before() { await openTab('dopis', '.email'); },
  },
  { calculator: true },
];

// ---------- overlay ----------

let i = 0;
let root = null;

export function startTour() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  i = 0;
  show();
}

function stop() {
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place);
  root?.remove();
  root = null;
}

function onKey(e) {
  if (e.key === 'Escape') stop();
  if (e.key === 'ArrowRight' && !root.classList.contains('busy')) next();
  if (e.key === 'ArrowLeft' && !root.classList.contains('busy')) back();
}

const next = () => { if (i < STEPS.length - 1) { i++; show(); } };
const back = () => { if (i > 0) { i--; show(); } };

const progress = () =>
  `<div class="tour-progress">${STEPS.map((_, n) => `<span class="${n === i ? 'on' : n < i ? 'done' : ''}"></span>`).join('')}</div>`;

async function show() {
  const step = STEPS[i];
  const card = root.querySelector('.tour-card');
  root.classList.add('busy');
  card.innerHTML = '<p class="tour-wait">Učitavam…</p>';
  try { await step.before?.(); } catch { /* keep going: the card still explains the step */ }
  if (!root) return;
  root.classList.remove('busy');

  if (step.calculator) return showCalculator();

  const el = step.target && $(step.target);
  root.classList.toggle('centered', !el);
  if (el) scrollToTarget(el);
  card.innerHTML = `
    ${progress()}
    <div class="tour-step">Korak ${i} od ${STEPS.length - 1}</div>
    ${step.kpi ? `<div class="tour-kpi">${esc(step.kpi)}</div>` : ''}
    <h3>${esc(step.title)}</h3>
    <p>${esc(step.text)}</p>
    <div class="tour-actions">
      <button class="btn btn-sm tour-skip">Zatvori</button>
      <div class="btn-group">
        ${i > 0 ? '<button class="btn btn-sm tour-back">Natrag</button>' : ''}
        <button class="btn btn-primary tour-next">${i === 0 ? 'Kreni →' : 'Dalje →'}</button>
      </div>
    </div>`;
  if (i === 0) card.querySelector('.tour-step').remove();
  card.querySelector('.tour-next').onclick = next;
  card.querySelector('.tour-back')?.addEventListener('click', back);
  card.querySelector('.tour-skip').onclick = stop;
  place();
}

// Puts the highlighted element in the lower part of the screen, so the explanation card
// can sit above it and be the first thing the eye lands on.
function scrollToTarget(el) {
  const r = el.getBoundingClientRect();
  const tall = r.height > window.innerHeight * 0.4;
  const y = isPhone() || tall ? r.top + window.scrollY - 76 : r.top + window.scrollY - window.innerHeight * 0.5;
  window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
}

function place() {
  if (!root) return;
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');
  const step = STEPS[i];
  const el = !step.calculator && step.target && $(step.target);
  if (!el) {
    spot.style.display = 'none';
    root.classList.add('centered');
    card.style.cssText = '';
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign(spot.style, {
    display: 'block', top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });
  if (isPhone()) { card.style.cssText = ''; return; } // docked to the bottom on phones (CSS)
  const cw = Math.min(440, window.innerWidth - 32);
  const ch = card.offsetHeight;
  let top;
  if (r.top - ch - 16 >= 64) top = r.top - ch - 16; // above the target (preferred)
  else if (r.bottom + ch + 16 <= window.innerHeight) top = r.bottom + 16; // below
  else top = window.innerHeight - ch - 16; // tall target: bottom of the screen
  const left = Math.min(Math.max(16, r.left + Math.min(24, r.width / 4)), window.innerWidth - cw - 16);
  card.style.cssText = `top:${Math.max(64, top)}px;left:${left}px;width:${cw}px`;
}

// ---------- final step: savings calculator ----------

// With the agent the accountant only reviews exceptions: about a quarter of today's time
// (60 → 15 minutes in the pilot estimate).
const REVIEW_SHARE = 0.25;

function showCalculator() {
  root.classList.add('centered');
  root.querySelector('.tour-spot').style.display = 'none';
  const card = root.querySelector('.tour-card');
  card.style.cssText = '';
  card.innerHTML = `
    ${progress()}
    <div class="tour-step">Korak ${STEPS.length - 1} od ${STEPS.length - 1}</div>
    <h3 class="calc-title">Koliko bi to uštedjelo vašem uredu?</h3>
    <p>Upišite svoje brojke za mjesečnu PDV prijavu.</p>
    <div class="calc">
      <label>Broj klijenata<input type="number" min="1" value="200" data-k="klijenti"></label>
      <label>Minuta po klijentu danas<input type="number" min="1" value="60" data-k="prije"></label>
      <label>Računovođa koji rade PDV<input type="number" min="1" value="5" data-k="ljudi"></label>
      <label>Vrijednost sata rada (€)<input type="number" min="1" value="35" data-k="sat"></label>
    </div>
    <div class="calc-agent">S agentom: <b id="c-a"></b> po klijentu (samo pregled odstupanja)</div>
    <div class="calc-hero"><span class="calc-hero-num" id="c-y"></span><span>godišnje: vrijednost oslobođenog vremena</span></div>
    <div class="calc-out">
      <div><span class="calc-big" id="c-m"></span><span>mjesečno</span></div>
      <div><span class="calc-big" id="c-h"></span><span>sati mjesečno manje</span></div>
      <div><span class="calc-big" id="c-p"></span><span>sati mjesečno po računovođi</span></div>
    </div>
    <p class="tour-note">Procjena. Ušteda ovisi o broju klijenata i vremenu po klijentu. Broj računovođa pokazuje koliko se vremena oslobađa po osobi, za nove klijente bez novog zapošljavanja. Točne brojke mjere se zajedno na vašim procesima.</p>
    <p class="tour-note">Franko Gelo · <a href="mailto:franko.gelo1@gmail.com">franko.gelo1@gmail.com</a> · <a href="https://www.linkedin.com/in/franko-gelo-70ab3a404/" target="_blank" rel="noopener">LinkedIn</a></p>
    <div class="tour-actions">
      <button class="btn btn-sm tour-back">Natrag</button>
      <button class="btn btn-primary tour-done">Istražite sami</button>
    </div>`;
  const inputs = card.querySelectorAll('[data-k]');
  const fmt = (n) => Math.round(n).toLocaleString('hr-HR');
  const calc = () => {
    const v = Object.fromEntries([...inputs].map((x) => [x.dataset.k, Math.max(0, Number(x.value) || 0)]));
    const after = Math.max(1, Math.round(v.prije * REVIEW_SHARE));
    const hours = (v.klijenti * Math.max(0, v.prije - after)) / 60;
    card.querySelector('#c-a').textContent = `≈ ${after} min`;
    card.querySelector('#c-h').textContent = fmt(hours);
    card.querySelector('#c-p').textContent = fmt(hours / Math.max(1, v.ljudi));
    card.querySelector('#c-m').textContent = `${fmt(hours * v.sat)} €`;
    card.querySelector('#c-y').textContent = `${fmt(hours * v.sat * 12)} €`; // hero number
  };
  inputs.forEach((x) => x.addEventListener('input', calc));
  calc();
  card.querySelector('.tour-back').onclick = back;
  card.querySelector('.tour-done').onclick = stop;
}
