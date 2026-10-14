// CLI: full AI-assisted run for a client period (needs ANTHROPIC_API_KEY in .env).
// Usage: node scripts/agent.js [clientId] [period]
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDb, ROOT } from '../src/db.js';
import { runAgent } from '../src/ai/pipeline.js';
import { MODEL } from '../src/ai/client.js';
import { toHrAmount } from '../src/lib/util.js';

const [clientId = 'nordtech-adriatic', period = '2026-09'] = process.argv.slice(2);
const dataDir = join(ROOT, 'data', 'generated');
const { ured } = JSON.parse(readFileSync(join(dataDir, 'ured.json'), 'utf8'));
const db = openDb();

console.log(`PDV agent — ${clientId}, ${period} (model ${MODEL})\n`);
let r;
try {
  r = await runAgent(db, { clientId, period, dir: join(dataDir, clientId, period), firmName: ured.naziv });
} catch (e) {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
}
if (r) await report(r);

async function report(r) {

const icon = { red: '🔴', orange: '🟠' };
console.log();
for (const f of db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id').all(r.runId)) {
  const ai = JSON.parse(f.ai_objasnjenje || '{}');
  console.log(`${icon[f.ozbiljnost] ?? '•'} ${f.naslov}  [${ai.pravilo_id ?? '-'}, sigurnost: ${ai.sigurnost ?? '-'}${ai.treba_strucnu_provjeru ? ', stručna provjera' : ''}]`);
  if (ai.objasnjenje) console.log(`   ${ai.objasnjenje}`);
  if (ai.preporuka) console.log(`   → ${ai.preporuka}`);
  if (f.utjecaj_za_uplatu) console.log(`   Utjecaj na PDV za uplatu: ${toHrAmount(f.utjecaj_za_uplatu)} €`);
  console.log();
}
if (r.email) {
  console.log('--- Nacrt zahtjeva klijentu (HR) ---');
  console.log(`Predmet: ${r.email.hr.predmet}\n\n${r.email.hr.tijelo}\n`);
}
// Grade the PDF reading against the generator's ground truth (synthetic data only).
const keyPath = join(dataDir, clientId, period, 'answer_key.json');
try {
  const { pdf_tocno } = JSON.parse(readFileSync(keyPath, 'utf8'));
  const docs = db.prepare("SELECT * FROM documents WHERE client_id = ? AND period = ? AND source = 'PDF'").all(clientId, period);
  let ok = 0;
  for (const t of pdf_tocno) {
    const d = docs.find((d) => d.datoteka === t.datoteka);
    const facts = JSON.parse(d?.detalji || '{}');
    const good = d && d.broj_racuna === t.broj_racuna && d.datum_racuna === t.datum_racuna &&
      d.osnovica === Math.round(t.osnovica * 100) && facts.vrsta_isporuke === t.vrsta_isporuke;
    if (good) ok++;
    else console.log(`  ✗ PDF ${t.datoteka}: očekivano ${t.broj_racuna} / ${t.osnovica} / ${t.vrsta_isporuke}, pročitano ${d?.broj_racuna} / ${(d?.osnovica ?? 0) / 100} / ${facts.vrsta_isporuke}`);
  }
  console.log(`Čitanje PDF-ova: ${ok}/${pdf_tocno.length} točno`);
} catch {
  // no answer key for real data
}
const tokens = r.usage.filter(Boolean).reduce((s, u) => ({ in: s.in + (u.input_tokens ?? 0), out: s.out + (u.output_tokens ?? 0) }), { in: 0, out: 0 });
console.log(`PDV za uplatu: ${toHrAmount(r.summary.za_uplatu_prema_knjigama)} € prema knjigama → ${toHrAmount(r.summary.za_uplatu_nakon_ispravaka)} € nakon ispravaka`);
console.log(`Tokeni (bez cachea): ${tokens.in} ulaz, ${tokens.out} izlaz`);
}
