// SQLite storage (built into Node 22+, no native build step).
// One database for the whole practice: clients, periods, source documents, books, bank and findings.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB = join(ROOT, 'data', 'pdv-agent.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, naziv TEXT NOT NULL, oib TEXT NOT NULL, adresa TEXT,
  djelatnost TEXT, vlasnik TEXT, porezno_razdoblje TEXT
);
CREATE TABLE IF NOT EXISTS periods (
  client_id TEXT NOT NULL REFERENCES clients(id), period TEXT NOT NULL,
  rok_prijave TEXT, status TEXT NOT NULL, otvorene_stavke INTEGER, ima_podatke INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, period)
);
-- Source documents: eRačuni (XML), fiscalization records and foreign PDFs.
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, period TEXT NOT NULL,
  source TEXT NOT NULL,            -- ERACUN | FISKALIZACIJA | PDF
  smjer TEXT NOT NULL,             -- ULAZNI | IZLAZNI
  broj_racuna TEXT NOT NULL, datum_racuna TEXT, partner TEXT, partner_id TEXT, drzava TEXT,
  osnovica INTEGER, pdv INTEGER, ukupno INTEGER, stope TEXT, datoteka TEXT, detalji TEXT
);
CREATE TABLE IF NOT EXISTS book_entries (
  id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, period TEXT NOT NULL,
  knjiga TEXT NOT NULL,            -- URA | IRA
  rb INTEGER, datum_knjizenja TEXT, broj_racuna TEXT NOT NULL, datum_racuna TEXT,
  partner TEXT, oib_ili_vat_id TEXT, drzava TEXT, opis TEXT, vrsta TEXT,
  osnovica INTEGER, stopa INTEGER, pdv INTEGER, pretporez INTEGER, ukupno INTEGER
);
CREATE TABLE IF NOT EXISTS bank_tx (
  id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, period TEXT NOT NULL,
  datum TEXT, opis TEXT, protustrana TEXT, iban_protustrane TEXT, poziv_na_broj TEXT,
  iznos INTEGER, stanje INTEGER
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, period TEXT NOT NULL,
  started_at TEXT NOT NULL, summary TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id),
  client_id TEXT NOT NULL, period TEXT NOT NULL,
  kod TEXT NOT NULL, ozbiljnost TEXT NOT NULL, knjiga TEXT, broj_racuna TEXT, partner TEXT,
  naslov TEXT NOT NULL, detalji TEXT, utjecaj_za_uplatu INTEGER NOT NULL DEFAULT 0,
  zahtjev_klijentu INTEGER NOT NULL DEFAULT 0, dokazi TEXT, ispravak TEXT,
  status TEXT NOT NULL DEFAULT 'OTVORENO', ai_objasnjenje TEXT
);
CREATE TABLE IF NOT EXISTS client_requests (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id),
  client_id TEXT NOT NULL, period TEXT NOT NULL,
  hr_predmet TEXT, hr_tijelo TEXT, en_predmet TEXT, en_tijelo TEXT,
  status TEXT NOT NULL DEFAULT 'NACRT', created_at TEXT NOT NULL
);
`;

export function openDb(path = DEFAULT_DB) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
