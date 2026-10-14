// Validates the reconciliation against the generator's answer key:
// every injected error must be found, nothing else may be flagged, and the corrected
// VAT return and EC Sales List must equal the true ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from '../src/db.js';
import { importPortfolio, importClientPeriod } from '../src/import.js';
import { reconcile, loadPeriod } from '../src/core/reconcile.js';
import { isValidOib } from '../src/lib/util.js';

const DATA = join(ROOT, 'data', 'generated');
const DIR = join(DATA, 'nordtech-adriatic', '2026-09');
const key = JSON.parse(readFileSync(join(DIR, 'answer_key.json'), 'utf8'));

const db = openDb(':memory:');
importPortfolio(db, join(DATA, 'ured.json'));
importClientPeriod(db, { clientId: 'nordtech-adriatic', period: '2026-09', dir: DIR });
const result = reconcile(loadPeriod(db, 'nordtech-adriatic', '2026-09'), '2026-09');

const cents = (eur) => Math.round(eur * 100);
const sameRef = (f, e) => f.kod === e.kod && (e.broj_racuna ? f.broj_racuna === e.broj_racuna : f.partner === e.partner);

test('all client OIBs are valid', () => {
  for (const c of db.prepare('SELECT oib FROM clients').all()) assert.ok(isValidOib(c.oib), c.oib);
});

for (const e of key.greske) {
  test(`finds ${e.id} ${e.kod}`, () => {
    const f = result.findings.find((f) => sameRef(f, e));
    assert.ok(f, `not found: ${e.kod} ${e.broj_racuna ?? e.partner}`);
    assert.equal(f.ozbiljnost, e.ozbiljnost);
    assert.equal(f.zahtjev_klijentu, e.zahtjev_klijentu);
    assert.equal(f.utjecaj_za_uplatu, cents(e.utjecaj_za_uplatu), 'effect on VAT payable');
  });
}

test('no false positives', () => {
  const extra = result.findings.filter((f) => !key.greske.some((e) => sameRef(f, e)));
  assert.deepEqual(extra.map((f) => `${f.kod} ${f.broj_racuna ?? f.partner}`), []);
});

test('bank: non-invoice items are recognised, not flagged', () => {
  for (const t of key.ocekivano_bankovno.filter((t) => t.kategorija !== 'BEZ_RACUNA')) {
    const row = result.bank.find((b) => b.datum === t.datum && b.iznos === cents(t.iznos));
    assert.ok(row && row.status !== 'orange', `${t.opis} -> ${row?.kategorija}`);
    if (t.kategorija === 'PRETHODNO_RAZDOBLJE') assert.equal(row.kategorija, 'PRETHODNO RAZDOBLJE', t.opis);
    else assert.notEqual(row.kategorija, 'RAČUN', `${t.opis} must not be matched to an invoice`);
  }
  const invoicePayments = result.bank.filter((b) => b.kategorija === 'RAČUN');
  assert.equal(invoicePayments.length, 20, 'payments matched to current-period invoices');
});

test('corrected VAT return equals the true one', () => {
  const toEur = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && k !== 'stopa' ? v / 100 : v)));
  assert.deepEqual(toEur(result.totals.nakon_ispravaka.pdv), key.pdv_tocno);
  assert.deepEqual(toEur(result.totals.prema_knjigama.pdv), key.pdv_prema_knjigama);
});

test('corrected EC Sales List (ZP) equals the true one', () => {
  const zp = result.totals.nakon_ispravaka.zp.map((z) => ({ vat_id: z.vat_id, usluge: z.usluge / 100 }));
  assert.deepEqual(zp, key.zp_tocno);
});
