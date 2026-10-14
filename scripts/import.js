// Imports the generated practice data into SQLite: portfolio + every client period that has source files.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from '../src/db.js';
import { importPortfolio, importClientPeriod } from '../src/import.js';

const dataDir = join(ROOT, 'data', 'generated');
const db = openDb();

const n = importPortfolio(db, join(dataDir, 'ured.json'));
console.log(`Portfelj: ${n} klijenata`);

for (const p of db.prepare('SELECT client_id, period FROM periods WHERE ima_podatke = 1').all()) {
  const dir = join(dataDir, p.client_id, p.period);
  if (!existsSync(dir)) continue;
  const c = importClientPeriod(db, { clientId: p.client_id, period: p.period, dir });
  console.log(`${p.client_id} ${p.period}: URA ${c.URA}, IRA ${c.IRA}, banka ${c.banka}, fiskalizacija ${c.fiskalizacija}, eRačuni ${c.eracuni}, PDF ${c.pdf}`);
}
