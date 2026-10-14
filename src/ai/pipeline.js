// AI steps of a client period, wired to the database:
//   1. read foreign PDFs  -> facts stored on the document (used by the reconciliation rules)
//   2. reconcile          -> deterministic findings (src/core/reconcile.js)
//   3. explain findings   -> plain-language explanation + rule + confidence per finding
//   4. client request     -> HR/EN email draft for everything the client has to provide
import { join } from 'node:path';
import { readInvoicePdf, explainFindings, draftClientRequest } from './tasks.js';
import { runReconciliation } from '../core/reconcile.js';
import { cents } from '../lib/util.js';

const stripHr = (id) => (/^HR\d{11}$/.test(id) ? id.slice(2) : id);

// Stores what was read from a PDF on its document row. Pure DB write, no API call.
export function applyPdfExtraction(db, doc, x) {
  const incoming = doc.smjer === 'ULAZNI';
  const partnerVat = incoming ? x.izdavatelj_vat_id : x.primatelj_vat_id;
  const country = incoming ? x.izdavatelj_drzava : partnerVat.slice(0, 2);
  db.prepare(`UPDATE documents SET broj_racuna = ?, datum_racuna = ?, partner = ?, partner_id = ?, drzava = ?,
    osnovica = ?, pdv = ?, ukupno = ?, detalji = ? WHERE id = ?`).run(
    x.broj_racuna, x.datum_racuna, incoming ? x.izdavatelj : x.primatelj, stripHr(partnerVat.replace(/\s+/g, '')),
    country.toUpperCase(), cents(x.osnovica), cents(x.pdv), cents(x.ukupno),
    JSON.stringify({ izvor: 'AI', vrsta_isporuke: x.vrsta_isporuke, prijenos_porezne_obveze: x.prijenos_porezne_obveze,
      napomena_o_pdv: x.napomena_o_pdv, opis: x.opis, valuta: x.valuta }),
    doc.id,
  );
}

export async function readPdfs(db, { clientId, period, dir, log = () => {} }) {
  const docs = db.prepare("SELECT * FROM documents WHERE client_id = ? AND period = ? AND source = 'PDF'").all(clientId, period);
  const usage = [];
  for (const doc of docs) {
    const { data, usage: u, cached } = await readInvoicePdf(join(dir, doc.datoteka));
    applyPdfExtraction(db, doc, data);
    usage.push(u);
    log(`  ${doc.datoteka}: ${data.izdavatelj} → ${data.broj_racuna}, ${data.vrsta_isporuke}, ${data.osnovica} ${data.valuta}`);
  }
  return usage;
}

export async function explainRun(db, runId) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  const client = db.prepare(`SELECT c.*, p.rok_prijave FROM clients c JOIN periods p ON p.client_id = c.id
    WHERE c.id = ? AND p.period = ?`).get(run.client_id, run.period);
  const rows = db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id').all(runId);
  if (!rows.length) return { usage: [] };
  const findings = rows.map((r) => ({ ...r, dokazi: JSON.parse(r.dokazi || '[]') }));
  const { data, usage, cached } = await explainFindings({ client, period: run.period, findings });
  const upd = db.prepare('UPDATE findings SET ai_objasnjenje = ? WHERE id = ?');
  for (const n of data.nalazi) {
    const row = rows[n.indeks];
    if (row) upd.run(JSON.stringify({ objasnjenje: n.objasnjenje, preporuka: n.preporuka, pravilo_id: n.pravilo_id,
      sigurnost: n.sigurnost, treba_strucnu_provjeru: n.treba_strucnu_provjeru }), row.id);
  }
  return { usage: [usage], cached, explained: data.nalazi.length, total: rows.length };
}

export async function draftRequest(db, runId, firmName) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  const client = db.prepare(`SELECT c.*, p.rok_prijave FROM clients c JOIN periods p ON p.client_id = c.id
    WHERE c.id = ? AND p.period = ?`).get(run.client_id, run.period);
  const rows = db.prepare('SELECT * FROM findings WHERE run_id = ? AND zahtjev_klijentu = 1 ORDER BY id').all(runId);
  if (!rows.length) return null;
  const findings = rows.map((r) => ({ ...r, dokazi: JSON.parse(r.dokazi || '[]') }));
  const { data, usage } = await draftClientRequest({ client, period: run.period, firm: firmName, findings });
  db.prepare(`INSERT INTO client_requests (run_id, client_id, period, hr_predmet, hr_tijelo, en_predmet, en_tijelo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, run.client_id, run.period, data.hr.predmet, data.hr.tijelo, data.en.predmet, data.en.tijelo,
    new Date().toISOString());
  return { ...data, usage: [usage] };
}

// Full AI-assisted run for one client period.
export async function runAgent(db, { clientId, period, dir, firmName, log = console.log }) {
  const usage = [];
  log('1/4 Čitam strane račune (PDF)…');
  usage.push(...(await readPdfs(db, { clientId, period, dir, log })));
  log('2/4 Usklađujem knjige, eRačune i banku…');
  const result = runReconciliation(db, clientId, period);
  log(`  ${result.summary.crveno} crvenih, ${result.summary.narancasto} narančastih nalaza`);
  log('3/4 Objašnjavam nalaze…');
  const ex = await explainRun(db, result.runId);
  usage.push(...ex.usage);
  log('4/4 Pišem zahtjev klijentu…');
  const email = await draftRequest(db, result.runId, firmName);
  if (email) usage.push(...email.usage);
  return { ...result, email, usage };
}
