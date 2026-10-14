// Loads a client's period folder (books, bank, fiscalization export, eRačuni, PDFs) into SQLite.
// Idempotent: re-importing a client/period replaces its rows.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { parseCsv, parseAmount } from './core/csv.js';
import { tx } from './db.js';

const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, isArray: (n) => ['TaxSubtotal', 'InvoiceLine'].includes(n) });

const stripHr = (id) => (/^HR\d{11}$/.test(id) ? id.slice(2) : id);

export function parseUbl(text, clientOib) {
  const inv = xml.parse(text).Invoice;
  const party = (p) => {
    const party = p.Party;
    const vatId = party.PartyTaxScheme.CompanyID;
    return { name: party.PartyLegalEntity.RegistrationName, id: stripHr(vatId), country: party.PostalAddress.Country.IdentificationCode };
  };
  const supplier = party(inv.AccountingSupplierParty);
  const buyer = party(inv.AccountingCustomerParty);
  const incoming = buyer.id === clientOib;
  return {
    smjer: incoming ? 'ULAZNI' : 'IZLAZNI',
    broj_racuna: inv.ID,
    datum_racuna: inv.IssueDate,
    partner: incoming ? supplier.name : buyer.name,
    partner_id: incoming ? supplier.id : buyer.id,
    drzava: incoming ? supplier.country : buyer.country,
    osnovica: parseAmount(inv.LegalMonetaryTotal.TaxExclusiveAmount),
    pdv: parseAmount(inv.TaxTotal.TaxAmount),
    ukupno: parseAmount(inv.LegalMonetaryTotal.TaxInclusiveAmount),
    stope: inv.TaxTotal.TaxSubtotal.map((s) => ({
      kategorija: s.TaxCategory.ID,
      stopa: Number(s.TaxCategory.Percent),
      osnovica: parseAmount(s.TaxableAmount),
      pdv: parseAmount(s.TaxAmount),
    })),
    stavke: inv.InvoiceLine.map((l) => ({ opis: l.Item.Name, kolicina: Number(l.InvoicedQuantity), osnovica: parseAmount(l.LineExtensionAmount) })),
  };
}

export function importPortfolio(db, uredJsonPath) {
  const { klijenti } = JSON.parse(readFileSync(uredJsonPath, 'utf8'));
  const upClient = db.prepare(`INSERT INTO clients (id, naziv, oib, adresa, djelatnost, vlasnik, porezno_razdoblje)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET naziv = excluded.naziv, oib = excluded.oib,
    adresa = excluded.adresa, djelatnost = excluded.djelatnost, vlasnik = excluded.vlasnik, porezno_razdoblje = excluded.porezno_razdoblje`);
  const upPeriod = db.prepare(`INSERT INTO periods (client_id, period, rok_prijave, status, otvorene_stavke, ima_podatke)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, period) DO UPDATE SET rok_prijave = excluded.rok_prijave,
    status = excluded.status, otvorene_stavke = excluded.otvorene_stavke, ima_podatke = excluded.ima_podatke`);
  tx(db, () => {
    for (const k of klijenti) {
      upClient.run(k.id, k.naziv, k.oib, k.adresa, k.djelatnost, k.vlasnik, k.porezno_razdoblje);
      upPeriod.run(k.id, k.razdoblje, k.rok_prijave, k.status, k.otvorene_stavke ?? null, k.ima_podatke ? 1 : 0);
    }
  });
  return klijenti.length;
}

export function importClientPeriod(db, { clientId, period, dir }) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) throw new Error(`Nepoznat klijent: ${clientId}`);
  const csv = (name) => parseCsv(readFileSync(join(dir, name), 'utf8'));

  const counts = {};
  tx(db, () => {
    for (const t of ['documents', 'book_entries', 'bank_tx']) {
      db.prepare(`DELETE FROM ${t} WHERE client_id = ? AND period = ?`).run(clientId, period);
    }

    const insBook = db.prepare(`INSERT INTO book_entries (client_id, period, knjiga, rb, datum_knjizenja, broj_racuna, datum_racuna,
      partner, oib_ili_vat_id, drzava, opis, vrsta, osnovica, stopa, pdv, pretporez, ukupno)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [knjiga, file] of [['URA', 'knjiga-ura.csv'], ['IRA', 'knjiga-ira.csv']]) {
      const rows = csv(file);
      for (const r of rows) {
        insBook.run(clientId, period, knjiga, Number(r.rb), r.datum_knjizenja || r.datum_racuna, r.broj_racuna, r.datum_racuna,
          r.partner, r.oib_ili_vat_id, r.drzava, r.opis, r.vrsta, parseAmount(r.osnovica), Number(r.stopa), parseAmount(r.pdv),
          knjiga === 'URA' ? parseAmount(r.pretporez) : null, parseAmount(r.ukupno));
      }
      counts[knjiga] = rows.length;
    }

    const insBank = db.prepare(`INSERT INTO bank_tx (client_id, period, datum, opis, protustrana, iban_protustrane, poziv_na_broj, iznos, stanje)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const bank = csv('bankovni-izvod.csv');
    for (const t of bank) {
      insBank.run(clientId, period, t.datum, t.opis, t.protustrana, t.iban_protustrane, t.poziv_na_broj, parseAmount(t.iznos), parseAmount(t.stanje));
    }
    counts.banka = bank.length;

    const insDoc = db.prepare(`INSERT INTO documents (client_id, period, source, smjer, broj_racuna, datum_racuna, partner, partner_id, drzava,
      osnovica, pdv, ukupno, stope, datoteka, detalji) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const fiscal = csv('fiskalizacija-export.csv');
    for (const f of fiscal) {
      const incoming = f.smjer === 'ULAZNI';
      insDoc.run(clientId, period, 'FISKALIZACIJA', f.smjer, f.broj_racuna, f.datum_izdavanja,
        incoming ? f.naziv_izdavatelja : f.naziv_primatelja, incoming ? f.oib_izdavatelja : f.oib_primatelja, 'HR',
        parseAmount(f.osnovica), parseAmount(f.pdv), parseAmount(f.ukupno), null, f.datoteka, JSON.stringify({ status: f.status }));
    }
    counts.fiskalizacija = fiscal.length;

    const eDir = join(dir, 'eracuni');
    const xmlFiles = existsSync(eDir) ? readdirSync(eDir).filter((f) => f.endsWith('.xml')) : [];
    for (const f of xmlFiles) {
      const d = parseUbl(readFileSync(join(eDir, f), 'utf8'), client.oib);
      insDoc.run(clientId, period, 'ERACUN', d.smjer, d.broj_racuna, d.datum_racuna, d.partner, d.partner_id, d.drzava,
        d.osnovica, d.pdv, d.ukupno, JSON.stringify(d.stope), `eracuni/${f}`, JSON.stringify({ stavke: d.stavke }));
    }
    counts.eracuni = xmlFiles.length;

    // PDFs are only registered here; reading them is the AI layer's job.
    let pdfs = 0;
    for (const [folder, smjer] of [['strani-racuni', 'ULAZNI'], ['izlazni-racuni', 'IZLAZNI']]) {
      const p = join(dir, folder);
      if (!existsSync(p)) continue;
      for (const f of readdirSync(p).filter((f) => f.endsWith('.pdf'))) {
        insDoc.run(clientId, period, 'PDF', smjer, '', null, null, null, null, null, null, null, null, `${folder}/${f}`, null);
        pdfs++;
      }
    }
    counts.pdf = pdfs;
  });
  return counts;
}
