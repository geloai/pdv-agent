// Offline tests for the AI layer: no API calls. A correct PDF reading is simulated from the
// generator's ground truth to check that the rules use it properly, and a wrong reading is
// simulated to check that it gets caught instead of silently trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from '../src/db.js';
import { importPortfolio, importClientPeriod } from '../src/import.js';
import { reconcile, loadPeriod } from '../src/core/reconcile.js';
import { applyPdfExtraction } from '../src/ai/pipeline.js';

const DATA = join(ROOT, 'data', 'generated');
const DIR = join(DATA, 'nordtech-adriatic', '2026-09');
const key = JSON.parse(readFileSync(join(DIR, 'answer_key.json'), 'utf8'));

function setup(mutate = (x) => x) {
  const db = openDb(':memory:');
  importPortfolio(db, join(DATA, 'ured.json'));
  importClientPeriod(db, { clientId: 'nordtech-adriatic', period: '2026-09', dir: DIR });
  for (const doc of db.prepare("SELECT * FROM documents WHERE source = 'PDF'").all()) {
    const t = key.pdf_tocno.find((p) => p.datoteka === doc.datoteka);
    applyPdfExtraction(db, doc, mutate({
      ...t,
      izdavatelj: `Izdavatelj ${t.izdavatelj_vat_id}`,
      primatelj: `Primatelj ${t.primatelj_vat_id}`,
      izdavatelj_drzava: t.izdavatelj_vat_id.slice(0, 2),
      opis: '', valuta: 'EUR', prijenos_porezne_obveze: true, napomena_o_pdv: 'Reverse charge',
    }));
  }
  return reconcile(loadPeriod(db, 'nordtech-adriatic', '2026-09'), '2026-09');
}

test('correct PDF readings: same findings, no new ones', () => {
  const r = setup();
  const codes = r.findings.map((f) => `${f.kod} ${f.broj_racuna ?? f.partner}`).sort();
  const expected = key.greske.map((e) => `${e.kod} ${e.broj_racuna ?? e.partner}`).sort();
  assert.deepEqual(codes, expected);
});

test('correct PDF readings: EU finding is confirmed by the invoice, not assumed', () => {
  const f = setup().findings.find((f) => f.kod === 'EU_USLUGA_BEZ_PRIJENOSA_POREZNE_OBVEZE');
  assert.match(f.detalji, /Prema računu riječ je o usluzi/);
  assert.equal(f.dokazi[0].vrsta, 'pdf');
});

test('a misread amount on a foreign invoice is flagged, not trusted silently', () => {
  const r = setup((x) => (x.broj_racuna === 'CF-INV-448821' ? { ...x, osnovica: 2430 } : x));
  assert.ok(r.findings.some((f) => f.kod === 'IZNOS_RAZLICIT_OD_RACUNA' && f.broj_racuna === 'CF-INV-448821'));
});

test('a PDF classified as goods changes the EU treatment', () => {
  const r = setup((x) => (x.broj_racuna === 'NS-IC-2026-0917' ? { ...x, vrsta_isporuke: 'DOBRA' } : x));
  const f = r.findings.find((f) => f.kod === 'EU_USLUGA_BEZ_PRIJENOSA_POREZNE_OBVEZE');
  assert.equal(f.ispravak.set.vrsta, 'EU_STJECANJE_DOBARA');
});

test('structured output schemas are strict (additionalProperties false, all keys required)', async () => {
  const src = readFileSync(join(ROOT, 'src', 'ai', 'tasks.js'), 'utf8');
  assert.match(src, /additionalProperties: false/);
  assert.match(src, /required: Object\.keys\(properties\)/);
});
