// CLI: run the VAT reconciliation for a client period and print the result.
// Usage: node scripts/reconcile.js [clientId] [period]
import { openDb } from '../src/db.js';
import { runReconciliation } from '../src/core/reconcile.js';
import { toHrAmount } from '../src/lib/util.js';

const [clientId = 'nordtech-adriatic', period = '2026-09'] = process.argv.slice(2);
const db = openDb();
const r = runReconciliation(db, clientId, period);

const eur = (c) => `${toHrAmount(c).padStart(12)} €`;
const icon = { red: '🔴', orange: '🟠', info: '🔵', green: '🟢' };

console.log(`\nUsklada PDV-a — ${clientId}, ${period} (run #${r.runId})\n`);
for (const f of r.findings) {
  console.log(`${icon[f.ozbiljnost]} ${f.naslov}`);
  console.log(`   ${f.detalji}`);
  if (f.utjecaj_za_uplatu) console.log(`   Utjecaj na PDV za uplatu: ${toHrAmount(f.utjecaj_za_uplatu)} €`);
  if (f.zahtjev_klijentu) console.log('   → zahtjev prema klijentu');
  console.log();
}

const s = r.summary;
console.log(`Retci u knjigama: ${s.zeleno_redaka}/${s.ukupno_redaka} usklađeno · nalazi: ${s.crveno} crvenih, ${s.narancasto} narančastih · zahtjeva klijentu: ${s.zahtjeva_klijentu}`);
const bankInfo = r.bank.reduce((m, t) => ((m[t.kategorija] = (m[t.kategorija] ?? 0) + 1), m), {});
console.log(`Banka: ${Object.entries(bankInfo).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`\nPDV za uplatu prema knjigama:    ${eur(s.za_uplatu_prema_knjigama)}`);
console.log(`PDV za uplatu nakon ispravaka:   ${eur(s.za_uplatu_nakon_ispravaka)}`);
console.log(`Razlika:                         ${eur(s.za_uplatu_nakon_ispravaka - s.za_uplatu_prema_knjigama)}`);
const zp = r.totals.nakon_ispravaka.zp.map((z) => `${z.vat_id} ${toHrAmount(z.usluge)} €`).join(', ');
console.log(`ZP obrazac nakon ispravaka:      ${zp || '—'}\n`);
