// Web dashboard for the accounting firm: process map, client portfolio and the VAT workflow per client.
import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDb, ROOT } from './db.js';
import { loadPeriod, reconcile, runReconciliation, applyCorrections, totalsOf } from './core/reconcile.js';
import { runAgent } from './ai/pipeline.js';
import { answerQuestion } from './ai/tasks.js';
import { processMap } from './web/process-map.js';
import { importPortfolio, importClientPeriod } from './import.js';

const DATA_DIR = join(ROOT, 'data', 'generated');
const db = openDb();

// Fresh deployment (e.g. Render): build the database from the committed demo data.
if (!db.prepare('SELECT COUNT(*) AS n FROM clients').get().n) {
  importPortfolio(db, join(DATA_DIR, 'ured.json'));
  for (const p of db.prepare('SELECT client_id, period FROM periods WHERE ima_podatke = 1').all()) {
    importClientPeriod(db, { clientId: p.client_id, period: p.period, dir: join(DATA_DIR, p.client_id, p.period) });
  }
  console.log('Baza napunjena demo podacima.');
}
const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, 'src', 'web', 'public')));

// Source documents (eRačuni, PDFs) for evidence links. The answer key is for tests only.
app.use('/dokumenti', (req, res, next) => (/answer_key/i.test(req.path) ? res.sendStatus(404) : next()));
app.use('/dokumenti', express.static(DATA_DIR));

const firm = () => JSON.parse(readFileSync(join(DATA_DIR, 'ured.json'), 'utf8')).ured;
const parse = (s, fallback) => (s ? JSON.parse(s) : fallback);

app.get('/api/ured', (req, res) => {
  const klijenti = db.prepare(`SELECT c.*, p.period, p.rok_prijave, p.status, p.otvorene_stavke, p.ima_podatke
    FROM clients c JOIN periods p ON p.client_id = c.id ORDER BY p.ima_podatke DESC, c.naziv`).all();
  res.json({ ured: firm(), klijenti });
});

app.get('/api/proces', (req, res) => res.json(processMap()));

function periodStatus(clientId, period, runId) {
  const open = db.prepare("SELECT * FROM findings WHERE run_id = ? AND status = 'OTVORENO'").all(runId);
  const status = open.some((f) => f.zahtjev_klijentu) ? 'CEKA_KLIJENTA' : open.length ? 'CEKA_PREGLED' : 'SPREMNO_ZA_PREDAJU';
  db.prepare('UPDATE periods SET status = ?, otvorene_stavke = ? WHERE client_id = ? AND period = ?').run(status, open.length, clientId, period);
}

function periodState(clientId, period) {
  const klijent = db.prepare(`SELECT c.*, p.period, p.rok_prijave, p.status, p.otvorene_stavke, p.ima_podatke
    FROM clients c JOIN periods p ON p.client_id = c.id WHERE c.id = ? AND p.period = ?`).get(clientId, period);
  if (!klijent) return null;
  if (!klijent.ima_podatke) return { klijent, run: null };

  const data = loadPeriod(db, clientId, period);
  const izvori = {
    eracuni: data.eracuni.length, fiskalizacija: data.fiscal.length, pdf: data.pdfs.length,
    pdf_procitano: data.pdfs.filter((d) => d.partner_id).length,
    ura: data.ura.length, ira: data.ira.length, banka: data.bank.length,
  };
  const run = db.prepare('SELECT * FROM runs WHERE client_id = ? AND period = ? ORDER BY id DESC LIMIT 1').get(clientId, period);
  if (!run) return { klijent, run: null, izvori };

  const nalazi = db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id').all(run.id).map((f) => ({
    ...f, ai: parse(f.ai_objasnjenje, null), dokazi: parse(f.dokazi, []), ispravak: parse(f.ispravak, null),
    zahtjev_klijentu: Boolean(f.zahtjev_klijentu),
  }));
  // "After corrections" applies every correction the accountant has not rejected.
  const prihvaceni = nalazi.filter((f) => f.status !== 'ODBACENO').map((f) => f.ispravak);
  const live = reconcile(data, period); // row and bank statuses (deterministic, same rules as the run)
  const dopis = db.prepare('SELECT * FROM client_requests WHERE run_id = ? ORDER BY id DESC LIMIT 1').get(run.id) ?? null;

  return {
    klijent,
    izvori,
    run: { id: run.id, vrijeme: run.started_at, sazetak: parse(run.summary, {}) },
    nalazi,
    obrazac: { prema_knjigama: totalsOf({ URA: data.ura, IRA: data.ira }), nakon_ispravaka: totalsOf(applyCorrections(data, prihvaceni)) },
    ura: live.ura,
    ira: live.ira,
    banka: live.bank,
    dopis,
  };
}

app.get('/api/klijenti/:id/:period', (req, res) => {
  const s = periodState(req.params.id, req.params.period);
  if (!s) return res.status(404).json({ greska: 'Nepoznat klijent ili razdoblje' });
  res.json(s);
});

// Runs the agent and streams progress as NDJSON lines.
app.post('/api/klijenti/:id/:period/pokreni', async (req, res) => {
  const { id, period } = req.params;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  const lastRun = () => db.prepare('SELECT MAX(id) AS id FROM runs WHERE client_id = ? AND period = ?').get(id, period).id ?? 0;
  const before = lastRun();
  try {
    await runAgent(db, { clientId: id, period, dir: join(DATA_DIR, id, period), firmName: firm().naziv, log: (t) => send({ tip: 'log', tekst: t.trim() }) });
  } catch (e) {
    send({ tip: 'upozorenje', tekst: `AI korak nije uspio: ${e.message}. Prikazujem rezultat usklade bez AI objašnjenja.` });
    if (lastRun() === before) runReconciliation(db, id, period);
  }
  send({ tip: 'gotovo' });
  res.end();
});

// Prepared questions are answered once with an API key and committed to the AI cache,
// so the public demo (no key) can answer them too.
const PREDLOZENA_PITANJA = [
  'Što još trebam od klijenta prije predaje prijave?',
  'Zašto se za gorivo priznaje samo 50 % pretporeza?',
  'Zašto se PDV za uplatu povećava za 1.126,63 €?',
  'Koji nalazi traže stručnu provjeru prije predaje?',
];

app.get('/api/pitanja', (req, res) => res.json(PREDLOZENA_PITANJA));

app.post('/api/klijenti/:id/:period/pitaj', async (req, res) => {
  const pitanje = String(req.body?.pitanje ?? '').trim().slice(0, 500);
  if (!pitanje) return res.status(400).json({ greska: 'Pitanje je prazno.' });
  const { id, period } = req.params;
  const klijent = db.prepare(`SELECT c.*, p.rok_prijave FROM clients c JOIN periods p ON p.client_id = c.id
    WHERE c.id = ? AND p.period = ?`).get(id, period);
  const run = db.prepare('SELECT * FROM runs WHERE client_id = ? AND period = ? ORDER BY id DESC LIMIT 1').get(id, period);
  if (!klijent || !run) return res.status(400).json({ greska: 'Prvo pokreni uskladu.' });
  const nalazi = db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id').all(run.id)
    .map((f) => ({ ...f, ai: parse(f.ai_objasnjenje, null) }));
  try {
    const { data } = await answerQuestion({ client: klijent, period, summary: parse(run.summary, {}), findings: nalazi, question: pitanje });
    res.json({
      uvod: data.uvod,
      stavke: data.stavke,
      zakljucak: data.zakljucak,
      povezani: data.povezani_nalazi.map((t) => nalazi.find((f) => f.naslov === t)).filter(Boolean).map((f) => ({ id: f.id, naslov: f.naslov })),
      pravila: data.pravila,
    });
  } catch (e) {
    if (/API ključa/.test(e.message)) {
      return res.json({ info: 'Ovo je demo verzija, pa agent odgovara na ponuđena pitanja iznad. U punoj verziji možete ga pitati bilo što o klijentu i njegovim dokumentima.' });
    }
    res.json({ greska: `Agent trenutno ne može odgovoriti: ${e.message}` });
  }
});

app.post('/api/nalazi/:id/status', (req, res) => {
  const { status } = req.body ?? {};
  if (!['OTVORENO', 'ODOBRENO', 'ODBACENO'].includes(status)) return res.status(400).json({ greska: 'Neispravan status' });
  const f = db.prepare('SELECT * FROM findings WHERE id = ?').get(req.params.id);
  if (!f) return res.sendStatus(404);
  db.prepare('UPDATE findings SET status = ? WHERE id = ?').run(status, f.id);
  periodStatus(f.client_id, f.period, f.run_id);
  res.json(periodState(f.client_id, f.period));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`PDV Agent: http://localhost:${port}`));
