// Guided tour through the real demo, focused on one message: time and money saved.
// Drives the app through the DOM only (hash navigation and button clicks), so it shows
// exactly what a user would see.

const CLIENT = '#/klijent/nordtech-adriatic/2026-09';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(120);
  }
}
const $ = (s) => document.querySelector(s);

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

const STEPS = [
  {
    center: true,
    title: 'Kako AI štedi vrijeme i novac računovodstvenom uredu',
    text: 'Dvije minute: gdje u uredu odlaze sati, kako AI agent pripremi mjesečnu PDV prijavu i koliko to vrijedi za ured. Podaci su izmišljeni, a aplikacija je prava.',
    async before() { await go('#/proces', 'tr.pilot'); },
  },
  {
    target: 'tr.pilot',
    title: '1. Gdje odlaze sati',
    text: 'PDV usklada: svaki klijent, svaki mjesec, oko 60 minuta ručnog uspoređivanja knjiga, eRačuna i banke. U uredu sa 120 klijenata to je oko 120 sati mjesečno.',
    async before() { await go('#/proces', 'tr.pilot'); },
  },
  {
    target: '.tile.emph',
    title: '2. Cilj: sa 60 na 15 minuta po klijentu',
    text: 'Računovođa više ne provjerava stavku po stavku, nego pregledava samo odstupanja koja agent pronađe. Procjena: oko 90 sati manje svaki mjesec.',
    async before() { await go('#/proces', '.tile.emph'); },
  },
  {
    target: 'tr[data-href]',
    title: '3. Cijeli ured na jednom mjestu',
    text: 'Za svakog klijenta vidi se rok, status i broj otvorenih stavki. Klijenti kod kojih je sve u redu ne oduzimaju vrijeme.',
    async before() { await go('#/portfelj', 'tr[data-href]'); },
  },
  {
    target: '.sources',
    title: '4. Agent radi ono što je trajalo sat vremena',
    text: 'Čita strane PDF račune, uspoređuje knjige s fiskaliziranim eRačunima i bankom te primjenjuje PDV pravila. Za ovog klijenta: 23 eRačuna, 6 PDF računa, 30 knjiženja i 27 bankovnih transakcija, u nekoliko sekundi.',
    async before() { await ensureRun(); },
  },
  {
    target: '.tiles .tile:nth-child(2)',
    title: '5. Pronađeno 1.126,63 € razlike',
    text: 'Prema knjigama klijent bi platio 7.235,34 € PDV-a, a točno je 8.361,97 €. Bez ove provjere ured bi predao netočnu prijavu, s rizikom kamata i kazne. Ovo je jedan klijent u jednom mjesecu.',
    async before() { await ensureRun(); },
  },
  {
    target: '.tiles .tile:nth-child(4)',
    title: '6. Pregledava se samo ono što treba',
    text: '22 od 30 knjiženja agent je potvrdio sam. Računovođa pregledava 10 nalaza umjesto svih dokumenata.',
    async before() { await ensureRun(); },
  },
  {
    target: '.finding',
    title: '7. Svaki nalaz je objašnjen, a odluka ostaje računovođi',
    text: 'Objašnjenje, pravilo i točan utjecaj na PDV. Iznose računa program, a ne AI, pa su točni do centa. Računovođa samo prihvati ili odbaci ispravak.',
    async before() { await openTab('nalazi', '.finding'); },
  },
  {
    target: '.msg-a',
    title: '8. Umjesto traženja po papirima: pitajte agenta',
    text: '"Što još trebam od klijenta?" Agent odgovara iz nalaza i PDV pravila, s poveznicama na svaki nalaz.',
    async before() {
      await openTab('agent', '[data-q]');
      if (!$('.msg-a')) $('[data-q]').click();
      await waitFor(() => $('.msg-a') && !$('.msg-a .muted'), 30000);
    },
  },
  {
    target: '.email',
    title: '9. Dopis klijentu je već napisan',
    text: 'Popis dokumenata koji nedostaju, na hrvatskom ili engleskom, spreman za slanje. Još jedan posao manje.',
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
  if (el) {
    el.scrollIntoView({ block: window.innerWidth < 700 ? 'start' : 'center', behavior: 'instant' });
    await sleep(60);
  }
  card.innerHTML = `
    <div class="tour-progress">${STEPS.map((_, n) => `<span class="${n === i ? 'on' : n < i ? 'done' : ''}"></span>`).join('')}</div>
    <h3>${esc(step.title)}</h3>
    <p>${esc(step.text)}</p>
    <div class="tour-actions">
      <button class="btn btn-sm tour-skip">Zatvori</button>
      <div class="btn-group">
        ${i > 0 ? '<button class="btn btn-sm tour-back">Natrag</button>' : ''}
        <button class="btn btn-sm btn-primary tour-next">${i === 0 ? 'Kreni →' : 'Dalje →'}</button>
      </div>
    </div>`;
  card.querySelector('.tour-next').onclick = next;
  card.querySelector('.tour-back')?.addEventListener('click', back);
  card.querySelector('.tour-skip').onclick = stop;
  place();
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
  if (window.innerWidth < 700) { card.style.cssText = ''; return; } // docked to the bottom on phones (CSS)
  const cw = Math.min(400, window.innerWidth - 32);
  const ch = card.offsetHeight;
  let top = r.bottom + 14;
  if (top + ch > window.innerHeight - 12) top = Math.max(12, r.top - ch - 14);
  const left = Math.min(Math.max(16, r.left), window.innerWidth - cw - 16);
  card.style.cssText = `top:${top}px;left:${left}px;width:${cw}px`;
}

// ---------- final step: savings calculator ----------

function showCalculator() {
  root.classList.add('centered');
  root.querySelector('.tour-spot').style.display = 'none';
  const card = root.querySelector('.tour-card');
  card.style.cssText = '';
  card.innerHTML = `
    <div class="tour-progress">${STEPS.map((_, n) => `<span class="${n === i ? 'on' : 'done'}"></span>`).join('')}</div>
    <h3>10. Što to znači za vaš ured?</h3>
    <p>Upišite svoje brojke. Izračun je samo za PDV uskladu, a isti pristup primjenjuje se i na druge procese.</p>
    <div class="calc">
      <label>Broj klijenata<input type="number" min="1" value="120" data-k="klijenti"></label>
      <label>Trošak sata rada (€)<input type="number" min="1" value="25" data-k="sat"></label>
      <label>Minuta po klijentu danas<input type="number" min="1" value="60" data-k="prije"></label>
      <label>Minuta po klijentu s agentom<input type="number" min="0" value="15" data-k="poslije"></label>
    </div>
    <div class="calc-out">
      <div><span class="calc-big" id="c-h"></span><span>sati mjesečno manje</span></div>
      <div><span class="calc-big" id="c-m"></span><span>mjesečno</span></div>
      <div><span class="calc-big" id="c-y"></span><span>godišnje</span></div>
    </div>
    <p class="tour-note">Ilustrativni izračun. Na stvarnom projektu prvi korak je zajedno izmjeriti stvarno vrijeme na vašim procesima, pa tek onda graditi.</p>
    <p class="tour-note">Izradio Franko Gelo · <a href="mailto:franko.gelo1@gmail.com">franko.gelo1@gmail.com</a> · <a href="https://www.linkedin.com/in/franko-gelo-70ab3a404/" target="_blank" rel="noopener">LinkedIn</a></p>
    <div class="tour-actions">
      <button class="btn btn-sm tour-back">Natrag</button>
      <button class="btn btn-sm btn-primary tour-done">Istražite demo sami</button>
    </div>`;
  const inputs = card.querySelectorAll('[data-k]');
  const fmt = (n, d = 0) => n.toLocaleString('hr-HR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const calc = () => {
    const v = Object.fromEntries([...inputs].map((x) => [x.dataset.k, Math.max(0, Number(x.value) || 0)]));
    const hours = (v.klijenti * Math.max(0, v.prije - v.poslije)) / 60;
    card.querySelector('#c-h').textContent = fmt(hours);
    card.querySelector('#c-m').textContent = `${fmt(hours * v.sat)} €`;
    card.querySelector('#c-y').textContent = `${fmt(hours * v.sat * 12)} €`;
  };
  inputs.forEach((x) => x.addEventListener('input', calc));
  calc();
  card.querySelector('.tour-back').onclick = back;
  card.querySelector('.tour-done').onclick = stop;
}
