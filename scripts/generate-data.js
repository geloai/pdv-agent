// Generates the synthetic dataset for the PDV Agent demo.
//
// Fictional accounting firm "Adria Ledger Partners d.o.o." with five client companies.
// Full source documents are generated for Nordtech Adriatic d.o.o., period September 2026
// (monthly VAT period: the company receives services from other EU member states).
//
// The generator first builds the TRUE set of invoices, then derives the client's books
// (URA/IRA) from them and injects ten realistic errors. Everything the reconciliation must
// find is written to answer_key.json, together with the correct VAT totals.
//
// All companies, people, tax numbers and amounts are fictional.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, makeOib, cents, vatOf, toEur, toCsv } from '../src/lib/util.js';
import { vatTotals, zpTotals } from '../src/core/vat.js';
import { invoiceToUbl } from '../src/lib/ubl.js';
import { writeInvoicePdf } from '../src/lib/pdf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'generated');
const PERIOD = { id: '2026-09', start: '2026-09-01', end: '2026-09-30', label: 'rujan 2026.' };

const rng = createRng(20260930);

// ---------- companies ----------

const hrCompany = (name, street, city) => {
  const oib = makeOib(rng);
  return { name, oib, vatId: `HR${oib}`, country: 'HR', countryName: 'Croatia', street, city, iban: `HR${rng.digits(19)}` };
};
const euCompany = (name, country, countryName, vatId, street, city) => ({
  name, oib: null, vatId, country, countryName, street, city, iban: `${country}${rng.digits(20)}`,
});

const firm = hrCompany('Adria Ledger Partners d.o.o.', 'Savska cesta 41', '10000 Zagreb');
const client = hrCompany('Nordtech Adriatic d.o.o.', 'Ulica Grada Vukovara 269', '10000 Zagreb');

const S = {
  tower: hrCompany('Zagreb Tower Offices d.o.o.', 'Ulica Grada Vukovara 271', '10000 Zagreb'),
  elektra: hrCompany('Elektra Opskrba d.o.o.', 'Ulica kneza Branimira 1', '10000 Zagreb'),
  telekom: hrCompany('Telekom Adria d.d.', 'Heinzelova 33', '10000 Zagreb'),
  leasing: hrCompany('Leasing Plus d.o.o.', 'Slavonska avenija 6', '10000 Zagreb'),
  petrol: hrCompany('Petrol Centar d.o.o.', 'Oreškovićeva 3', '10000 Zagreb'),
  ured: hrCompany('Uredski Svijet d.o.o.', 'Zagrebačka cesta 145', '10000 Zagreb'),
  itoprema: hrCompany('IT Oprema d.o.o.', 'Radnička cesta 52', '10000 Zagreb'),
  restoran: hrCompany('Restoran Gornji Grad d.o.o.', 'Opatička 10', '10000 Zagreb'),
  cistoca: hrCompany('Čistoća Servis d.o.o.', 'Jankomir 25', '10000 Zagreb'),
  hotel: hrCompany('Hotel Panorama Split d.o.o.', 'Put Firula 12', '21000 Split'),
  kadrovi: hrCompany('Adria Kadrovi d.o.o.', 'Ilica 1', '10000 Zagreb'),
  kurir: hrCompany('Kurirska Brzina d.o.o.', 'Žitnjak 12', '10000 Zagreb'),
  sigurnost: hrCompany('Sigurnost Plus d.o.o.', 'Velika cesta 8', '10410 Velika Gorica'),
  akademija: hrCompany('Croatia Software Academy d.o.o.', 'Vukovarska 58', '10000 Zagreb'),
  parking: hrCompany('Parking Centar Zagreb d.o.o.', 'Trnjanska 11', '10000 Zagreb'),
  odvjetnici: hrCompany('Horvat i Partneri odvjetničko društvo d.o.o.', 'Trg bana Jelačića 5', '10000 Zagreb'),
};

const C = {
  pharma: hrCompany('Croatia Pharma Distribucija d.o.o.', 'Čapraška 6', '10000 Zagreb'),
  grid: hrCompany('Zagreb Smart Grid d.o.o.', 'Avenija Dubrovnik 15', '10000 Zagreb'),
  osiguranje: hrCompany('Jadranska Osiguranja d.d.', 'Miramarska 22', '10000 Zagreb'),
  agro: hrCompany('Lika Agro d.o.o.', 'Budačka 4', '53000 Gospić'),
  retail: hrCompany('Dalmacija Retail d.o.o.', 'Domovinskog rata 50', '21000 Split'),
};

const parent = euCompany('Nordtech Systems GmbH', 'DE', 'Germany', `DE${rng.digits(9)}`, 'Leopoldstrasse 120', '80802 Muenchen');
const cloudforge = euCompany('CloudForge Software Ltd', 'IE', 'Ireland', `IE${rng.digits(7)}W`, '22 Grand Canal Dock', 'Dublin 2');
const werkstatt = euCompany('Werkstatt Instruments GmbH', 'AT', 'Austria', `ATU${rng.digits(8)}`, 'Industriestrasse 14', '4020 Linz');
const datahaven = euCompany('Datahaven Hosting S.a r.l.', 'LU', 'Luxembourg', `LU${rng.digits(8)}`, '9 Rue du Fort', '1724 Luxembourg');

// ---------- invoices (ground truth) ----------

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const invoices = [];
function inv(o) {
  const lines = o.lines.map(([description, qty, netEur, vatRate, vatCategory = vatRate > 0 ? 'S' : 'AE']) => {
    const netCents = cents(netEur);
    return { description, qty, netCents, vatRate, vatCategory, vatCents: vatOf(netCents, vatRate) };
  });
  const netCents = lines.reduce((s, l) => s + l.netCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  const i = {
    id: `${o.direction}-${String(invoices.length + 1).padStart(3, '0')}`,
    supplyDate: o.issueDate,
    dueDate: addDays(o.issueDate, o.terms ?? 15),
    deductiblePct: 100,
    ...o,
    lines,
    netCents,
    vatCents,
    grossCents: netCents + vatCents,
  };
  invoices.push(i);
  return i;
}

// Incoming domestic eRačuni (URA)
const U = {};
const inDom = (key, supplier, number, issueDate, lines, extra = {}) =>
  (U[key] = inv({ direction: 'URA', channel: 'eracun', treatment: 'TUZEMNO', supplier, buyer: client, number, issueDate, lines, ...extra }));

inDom('rent', S.tower, '1184/1/1', '2026-09-01', [
  ['Najam poslovnog prostora 09/2026', 1, 4800.0, 25],
  ['Zajednički troškovi zgrade 09/2026', 1, 640.0, 25],
]);
inDom('struja', S.elektra, '2026-0087412/3/1', '2026-09-05', [['Električna energija 08/2026', 1, 612.4, 13]]);
inDom('telekom', S.telekom, '9921034/2/9', '2026-09-03', [['Telekomunikacijske usluge 09/2026', 1, 389.9, 25]]);
inDom('leasing1', S.leasing, '3310/1/1', '2026-09-01', [['Operativni leasing - osobno vozilo ZG-1234-NT 09/2026', 1, 620.0, 25]], { deductiblePct: 50, purpose: 'osobno vozilo' });
inDom('leasing2', S.leasing, '3311/1/1', '2026-09-01', [['Operativni leasing - osobno vozilo ZG-5678-NT 09/2026', 1, 585.0, 25]], { deductiblePct: 50, purpose: 'osobno vozilo' });
inDom('gorivo1', S.petrol, '55120/4/2', '2026-09-16', [['Gorivo - kartica flote 01.-15.09.2026 (osobna vozila)', 1, 412.8, 25]], { deductiblePct: 50, purpose: 'osobno vozilo' });
inDom('gorivo2', S.petrol, '56877/4/2', '2026-09-30', [['Gorivo - kartica flote 16.-30.09.2026 (osobna vozila)', 1, 398.2, 25]], { deductiblePct: 50, purpose: 'osobno vozilo', terms: 10 });
inDom('ured', S.ured, '742/1/1', '2026-09-08', [
  ['Papir A4, 80 g - 40 paketa', 40, 220.0, 25],
  ['Uredski pribor i toneri', 1, 1300.0, 25],
]);
inDom('laptopi', S.itoprema, '2026-1450/1/1', '2026-09-10', [['Prijenosno računalo 14" - 4 kom', 4, 6400.0, 25]]);
inDom('restoran', S.restoran, '881/2/1', '2026-09-11', [['Poslovni ručak s klijentom - reprezentacija', 1, 286.0, 13]], { deductiblePct: 0, purpose: 'reprezentacija' });
inDom('ciscenje', S.cistoca, '410/1/1', '2026-09-02', [['Čišćenje poslovnog prostora 09/2026', 1, 540.0, 25]]);
inDom('hotel', S.hotel, '2208/1/3', '2026-09-18', [['Smještaj - službeni put, 3 noćenja', 3, 360.0, 13]]);
inDom('kadrovi', S.kadrovi, '96/1/1', '2026-10-03', [['Usluga posredovanja pri zapošljavanju - 2 kandidata', 2, 3200.0, 25]]);
inDom('kurir', S.kurir, '12044/1/1', '2026-09-30', [['Kurirske usluge 09/2026', 1, 148.5, 25]]);
inDom('akademija', S.akademija, '233/1/1', '2026-09-12', [['Edukacija zaposlenika - cloud arhitektura (4 polaznika)', 4, 1800.0, 25]]);
inDom('parking', S.parking, '5521/1/1', '2026-09-01', [['Najam 6 parkirnih mjesta 09/2026', 6, 450.0, 25]]);
inDom('racunovodstvo', firm, '318/1/1', '2026-09-04', [['Računovodstvene usluge 08/2026', 1, 1450.0, 25]]);

// Not an eRačun: the supplier emailed a PDF, so it is NOT in the fiscalization data (error E1).
U.zastita = inv({
  direction: 'URA', channel: 'neispravan_pdf', treatment: 'TUZEMNO', supplier: S.sigurnost, buyer: client,
  number: '77/1/1', issueDate: '2026-09-05', lines: [['Tjelesna zaštita objekta 09/2026', 1, 980.0, 25]],
});

// Incoming foreign invoices (PDF)
const RC = 'Reverse charge - VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC).';
U.mgmtFee = inv({
  direction: 'URA', channel: 'pdf', treatment: 'EU_USLUGA_PPO', supplier: parent, buyer: client,
  number: 'NS-IC-2026-0917', issueDate: '2026-09-30', terms: 30,
  lines: [['Management fee - group services September 2026 (HR, finance, IT)', 1, 18500.0, 0]], legalNote: RC,
});
U.licence = inv({
  direction: 'URA', channel: 'pdf', treatment: 'EU_USLUGA_PPO', supplier: cloudforge, buyer: client,
  number: 'CF-INV-448821', issueDate: '2026-09-07', terms: 14,
  lines: [['Annual licence renewal - DevSuite Team, 25 seats', 25, 2340.0, 0]], legalNote: RC,
});
U.oprema = inv({
  direction: 'URA', channel: 'pdf', treatment: 'EU_STJECANJE_DOBARA', supplier: werkstatt, buyer: client,
  number: 'WI-26-03317', issueDate: '2026-09-15', terms: 30,
  lines: [['Precision test bench WI-500 incl. calibration kit', 1, 7900.0, 0, 'K']],
  legalNote: 'Tax-exempt intra-Community supply of goods (Art. 138 Council Directive 2006/112/EC).',
});
U.hosting = inv({
  direction: 'URA', channel: 'pdf', treatment: 'EU_USLUGA_PPO', supplier: datahaven, buyer: client,
  number: 'DH-2026-09-0412', issueDate: '2026-09-01', terms: 10,
  lines: [['Cloud hosting - dedicated cluster, September 2026', 1, 1120.0, 0]], legalNote: RC,
});

// Outgoing invoices (IRA)
const I = {};
const outDom = (key, buyer, number, issueDate, lines) =>
  (I[key] = inv({ direction: 'IRA', channel: 'eracun', treatment: 'TUZEMNO', supplier: client, buyer, number, issueDate, lines }));

outDom('pharma1', C.pharma, '201/1/1', '2026-09-02', [['Održavanje ERP integracije 09/2026', 1, 8400.0, 25]]);
outDom('grid', C.grid, '202/1/1', '2026-09-05', [['Razvoj softvera - faza 2 (milestone 3)', 1, 22500.0, 25]]);
outDom('osiguranje', C.osiguranje, '203/1/1', '2026-09-09', [['Konzalting - sigurnosni pregled aplikacija', 1, 6200.0, 25]]);
outDom('agro', C.agro, '204/1/1', '2026-09-14', [['Implementacija IoT senzora - 30 lokacija', 30, 11350.0, 25]]);
outDom('pharma2', C.pharma, '205/1/1', '2026-09-21', [['Licenca - modul izvještavanja (godišnja)', 1, 1900.0, 25]]);
outDom('retail', C.retail, '206/1/1', '2026-09-25', [['Podrška korisnicima 09/2026', 1, 2750.0, 25]]);

const EU_OUT_NOTE = 'Reverse charge - place of supply in the customer\'s member state (Art. 44 and 196 Council Directive 2006/112/EC; Art. 17(1) Croatian VAT Act).';
I.devParent = inv({
  direction: 'IRA', channel: 'pdf', treatment: 'EU_USLUGA', supplier: client, buyer: parent,
  number: '207/1/1', issueDate: '2026-09-30', terms: 30,
  lines: [['Software development services - September 2026', 1, 96000.0, 0]], legalNote: EU_OUT_NOTE,
});
I.consultParent = inv({
  direction: 'IRA', channel: 'pdf', treatment: 'EU_USLUGA', supplier: client, buyer: parent,
  number: '208/1/1', issueDate: '2026-09-30', terms: 30,
  lines: [['Engineering consulting - project Atlas (120 h)', 120, 14200.0, 0]], legalNote: EU_OUT_NOTE,
});

// ---------- the client's books (derived from truth, then corrupted) ----------

function bookRow(i, overrides = {}) {
  const party = i.direction === 'URA' ? i.supplier : i.buyer;
  const rate = i.lines[0].vatRate;
  let vatCents = i.vatCents;
  let rateOut = rate;
  if (i.treatment === 'EU_USLUGA_PPO' || i.treatment === 'EU_STJECANJE_DOBARA') {
    rateOut = 25;
    vatCents = vatOf(i.netCents, 25); // self-assessed VAT under reverse charge
  }
  const row = {
    invoiceId: i.id,
    datum_knjizenja: i.issueDate,
    broj_racuna: i.number,
    datum_racuna: i.issueDate,
    partner: party.name,
    oib_ili_vat_id: party.oib ?? party.vatId,
    drzava: party.country,
    opis: i.lines.map((l) => l.description).join(' + '),
    vrsta: i.treatment,
    osnovica: i.netCents,
    stopa: i.treatment === 'EU_USLUGA' ? 0 : rateOut,
    pdv: i.treatment === 'EU_USLUGA' ? 0 : vatCents,
    ukupno: i.grossCents,
  };
  if (i.direction === 'URA') row.pretporez = Math.round((vatCents * i.deductiblePct) / 100);
  return { ...row, ...overrides };
}

const ura = [];
const ira = [];

for (const i of invoices) {
  if (i.direction !== 'URA') continue;
  if (i === U.kurir) continue; // E2: fiscalized eRačun never booked
  if (i === U.ured) {
    // E3: typo 1.520,00 -> 1.250,00
    const net = cents(1250.0), vat = vatOf(net, 25);
    ura.push(bookRow(i, { osnovica: net, pdv: vat, pretporez: vat, ukupno: net + vat }));
    continue;
  }
  if (i === U.mgmtFee) {
    // E4: booked as a foreign invoice without VAT, reverse charge not applied
    ura.push(bookRow(i, { vrsta: 'INOZEMNO_BEZ_PDV', stopa: 0, pdv: 0, pretporez: 0 }));
    continue;
  }
  if (i === U.gorivo1) {
    // E6: full input VAT on a passenger-car cost (should be 50 %)
    ura.push(bookRow(i, { pretporez: i.vatCents }));
    continue;
  }
  if (i === U.restoran) {
    // E10: input VAT claimed on entertainment
    ura.push(bookRow(i, { pretporez: i.vatCents }));
    continue;
  }
  if (i === U.kadrovi) {
    // E8: October invoice booked into September
    ura.push(bookRow(i, { datum_knjizenja: '2026-09-30' }));
    continue;
  }
  ura.push(bookRow(i));
  if (i === U.telekom) ura.push(bookRow(i, { datum_knjizenja: '2026-09-12' })); // E7: booked twice
}
ura.sort((a, b) => a.datum_knjizenja.localeCompare(b.datum_knjizenja) || a.broj_racuna.localeCompare(b.broj_racuna));
ura.forEach((r, n) => (r.rb = n + 1));

for (const i of invoices) {
  if (i.direction !== 'IRA') continue;
  if (i === I.consultParent) {
    // E5: EU service coded as "other exempt" -> wrong form line, missing from the EC Sales List (ZP)
    ira.push(bookRow(i, { vrsta: 'OSLOBODJENO_OSTALO' }));
    continue;
  }
  ira.push(bookRow(i));
}
ira.forEach((r, n) => (r.rb = n + 1));

// ---------- bank statement ----------

const bank = [];
const tx = (datum, opis, partner, iznosCents, poziv = '', meta = {}) =>
  bank.push({ datum, opis, protustrana: partner?.name ?? '', iban_protustrane: partner?.iban ?? '', poziv_na_broj: poziv, iznos: iznosCents, ...meta });

const pay = (i, datum, opis) => tx(datum, opis ?? `Plaćanje računa ${i.number}`, i.supplier, -i.grossCents, `HR01 ${i.number}`, { invoiceId: i.id });
const receive = (i, datum) => tx(datum, `Uplata po računu ${i.number}`, i.buyer, i.grossCents, `HR01 ${i.number}`, { invoiceId: i.id });

pay(U.rent, '2026-09-08');
pay(U.parking, '2026-09-08');
pay(U.ciscenje, '2026-09-10');
pay(U.telekom, '2026-09-15');
pay(U.leasing1, '2026-09-15');
pay(U.leasing2, '2026-09-15');
pay(U.racunovodstvo, '2026-09-15');
pay(U.struja, '2026-09-19');
pay(U.ured, '2026-09-21'); // pays 1.900,00 - the real eRačun amount, not the mistyped book amount
pay(U.laptopi, '2026-09-24');
pay(U.akademija, '2026-09-26');
pay(U.zastita, '2026-09-18');
pay(U.gorivo1, '2026-09-25', 'Izravno terećenje - Petrol Centar kartica flote');
pay(U.hosting, '2026-09-09', 'SEPA plaćanje - Datahaven Hosting');
pay(U.licence, '2026-09-18', 'SEPA plaćanje - CloudForge Software');
tx('2026-09-12', 'Kartično plaćanje RESTORAN GORNJI GRAD ZAGREB', S.restoran, -U.restoran.grossCents, '', { invoiceId: U.restoran.id });
tx('2026-09-21', 'Kartično plaćanje HOTEL PANORAMA SPLIT', S.hotel, -U.hotel.grossCents, '', { invoiceId: U.hotel.id });

receive(I.pharma1, '2026-09-16');
receive(I.grid, '2026-09-22');
receive(I.osiguranje, '2026-09-29');

// Items that are not invoices for this period (the reconciliation must recognise them, not flag them)
tx('2026-09-03', 'Uplata po računu 182/1/1 (08/2026)', parent, cents(94500.0), 'HR01 182/1/1', { category: 'PRETHODNO_RAZDOBLJE' });
tx('2026-09-04', 'Uplata po računu 176/1/1 (08/2026)', C.retail, cents(3437.5), 'HR01 176/1/1', { category: 'PRETHODNO_RAZDOBLJE' });
tx('2026-09-15', 'Isplata plaća 08/2026', null, -cents(62400.0), 'HR69 08-2026', { category: 'PLACE' });
tx('2026-09-15', 'Porez na dohodak i doprinosi - JOPPD 08/2026', null, -cents(31215.42), 'HR68 1007', { category: 'POREZI_DOPRINOSI' });
tx('2026-09-19', 'Uplata PDV-a za 08/2026', null, -cents(18950.33), 'HR68 1201', { category: 'POREZI_DOPRINOSI' });
tx('2026-09-30', 'Naknada za vođenje računa 09/2026', null, -cents(45.0), '', { category: 'BANKOVNA_NAKNADA' });

// E9: payment with no invoice anywhere
tx('2026-09-22', 'Predujam - pravne usluge, savjetovanje', S.odvjetnici, -cents(2950.0), 'HR99', { category: 'BEZ_RACUNA' });

bank.sort((a, b) => a.datum.localeCompare(b.datum));
let balance = cents(184320.55);
for (const t of bank) {
  balance += t.iznos;
  t.stanje = balance;
}

// ---------- fiscalization export (what the Tax Administration has) ----------

const fiscal = invoices
  .filter((i) => i.channel === 'eracun' && i.issueDate >= PERIOD.start && i.issueDate <= PERIOD.end)
  .map((i) => ({
    smjer: i.direction === 'URA' ? 'ULAZNI' : 'IZLAZNI',
    broj_racuna: i.number,
    datum_izdavanja: i.issueDate,
    oib_izdavatelja: i.supplier.oib,
    naziv_izdavatelja: i.supplier.name,
    oib_primatelja: i.buyer.oib,
    naziv_primatelja: i.buyer.name,
    osnovica: toEur(i.netCents),
    pdv: toEur(i.vatCents),
    ukupno: toEur(i.grossCents),
    status: i.direction === 'URA' ? 'ZAPRIMLJEN' : 'FISKALIZIRAN',
    datoteka: `eracuni/${fileName(i)}.xml`,
  }));

function fileName(i) {
  return `${i.direction}_${i.number.replace(/[^\w-]+/g, '-')}`;
}

// ---------- correct VAT totals (truth) vs. what the books say ----------

const inPeriod = (i) => i.issueDate >= PERIOD.start && i.issueDate <= PERIOD.end;
const truthUra = invoices
  .filter((i) => i.direction === 'URA' && inPeriod(i) && i.channel !== 'neispravan_pdf')
  .map((i) => bookRow(i));
const truthIra = invoices.filter((i) => i.direction === 'IRA' && inPeriod(i)).map((i) => bookRow(i));

const truth = vatTotals(truthUra, truthIra);
const asBooked = vatTotals(ura, ira);

const zpTruth = zpTotals(truthIra);
const zpBooks = zpTotals(ira);

// ---------- answer key ----------

const ref = (i) => ({ broj_racuna: i.number, partner: (i.direction === 'URA' ? i.supplier : i.buyer).name, invoiceId: i.id });
const answerKey = [
  { id: 'E1', kod: 'URA_BEZ_FISKALIZIRANOG_ERACUNA', ozbiljnost: 'red', knjiga: 'URA', ...ref(U.zastita), utjecaj_za_uplatu: U.zastita.vatCents, zahtjev_klijentu: true,
    opis: 'Ulazni račun proknjižen s pretporezom, ali ne postoji kao fiskalizirani eRačun. Od 1. 1. 2026. papirnati/PDF račun u tuzemnom B2B prometu nije valjana isprava za pretporez.' },
  { id: 'E2', kod: 'ERACUN_NIJE_PROKNJIZEN', ozbiljnost: 'orange', knjiga: 'URA', ...ref(U.kurir), utjecaj_za_uplatu: -U.kurir.vatCents, zahtjev_klijentu: false,
    opis: 'Zaprimljeni eRačun postoji u fiskalizacijskim podacima, ali nije u knjizi URA. Pretporez nije iskorišten.' },
  { id: 'E3', kod: 'IZNOS_RAZLICIT_OD_ERACUNA', ozbiljnost: 'orange', knjiga: 'URA', ...ref(U.ured), utjecaj_za_uplatu: -(U.ured.vatCents - vatOf(cents(1250), 25)), zahtjev_klijentu: false,
    opis: 'Osnovica u knjizi (1.250,00) ne odgovara eRačunu (1.520,00). Plaćanje u banci (1.900,00) potvrđuje iznos s eRačuna.' },
  { id: 'E4', kod: 'EU_USLUGA_BEZ_PRIJENOSA_POREZNE_OBVEZE', ozbiljnost: 'red', knjiga: 'URA', ...ref(U.mgmtFee), utjecaj_za_uplatu: 0, zahtjev_klijentu: false,
    opis: 'Usluga primljena od poreznog obveznika iz EU proknjižena bez obračuna PDV-a. Primatelj mora obračunati PDV (25 %) i istovremeno ga može odbiti kao pretporez - nema utjecaja na uplatu, ali prijava i PDV-S obrazac su netočni.' },
  { id: 'E5', kod: 'EU_USLUGA_KRIVO_KLASIFICIRANA', ozbiljnost: 'red', knjiga: 'IRA', ...ref(I.consultParent), utjecaj_za_uplatu: 0, zahtjev_klijentu: false,
    opis: 'Usluga obavljena poreznom obvezniku u EU označena kao "ostale oslobođene isporuke". Iskazuje se u krivom retku PDV obrasca i nedostaje u ZP obrascu.' },
  { id: 'E6', kod: 'OSOBNO_VOZILO_PRETPOREZ_100', ozbiljnost: 'orange', knjiga: 'URA', ...ref(U.gorivo1), utjecaj_za_uplatu: U.gorivo1.vatCents - Math.round(U.gorivo1.vatCents / 2), zahtjev_klijentu: false,
    opis: 'Gorivo za osobna vozila: priznaje se 50 % pretporeza, a proknjiženo je 100 %.' },
  { id: 'E7', kod: 'DUPLI_RACUN', ozbiljnost: 'red', knjiga: 'URA', ...ref(U.telekom), utjecaj_za_uplatu: U.telekom.vatCents, zahtjev_klijentu: false,
    opis: 'Isti račun (dobavljač, broj, iznos) proknjižen dva puta.' },
  { id: 'E8', kod: 'RACUN_IZVAN_RAZDOBLJA', ozbiljnost: 'orange', knjiga: 'URA', ...ref(U.kadrovi), utjecaj_za_uplatu: U.kadrovi.vatCents, zahtjev_klijentu: false,
    opis: 'Račun izdan 3. 10. 2026. proknjižen u rujnu. Pretporez pripada listopadu.' },
  { id: 'E9', kod: 'PLACANJE_BEZ_RACUNA', ozbiljnost: 'orange', knjiga: 'BANKA', broj_racuna: null, partner: S.odvjetnici.name, utjecaj_za_uplatu: 0, zahtjev_klijentu: true,
    opis: 'Plaćanje 2.950,00 EUR dobavljaču bez računa u knjigama i bez eRačuna. Ako je predujam, dobavljač treba izdati račun za predujam.' },
  { id: 'E10', kod: 'REPREZENTACIJA_PRETPOREZ', ozbiljnost: 'orange', knjiga: 'URA', ...ref(U.restoran), utjecaj_za_uplatu: U.restoran.vatCents, zahtjev_klijentu: false,
    opis: 'Pretporez za troškove reprezentacije nije priznat, a proknjižen je u cijelosti.' },
];

const deltaFromKey = answerKey.reduce((s, e) => s + e.utjecaj_za_uplatu, 0);
const deltaComputed = truth.za_uplatu - asBooked.za_uplatu;
if (deltaFromKey !== deltaComputed) {
  throw new Error(`Answer key inconsistent: errors explain ${deltaFromKey} cents, books differ by ${deltaComputed} cents`);
}

// ---------- the rest of the portfolio (summary only) ----------

const portfolio = [
  { id: 'nordtech-adriatic', ...pick(client), djelatnost: 'IT i inženjerske usluge', vlasnik: 'Nordtech Systems GmbH (DE)', porezno_razdoblje: 'mjesečno', razdoblje: PERIOD.id, rok_prijave: '2026-10-20', status: 'NIJE_POKRENUTO', ima_podatke: true },
  { id: 'alpenhaus-retail', ...pick(hrCompany('Alpenhaus Retail d.o.o.', 'Zagrebačka avenija 104', '10000 Zagreb')), djelatnost: 'maloprodaja', vlasnik: 'Alpenhaus Handels AG (AT)', porezno_razdoblje: 'mjesečno', razdoblje: PERIOD.id, rok_prijave: '2026-10-20', status: 'SPREMNO_ZA_PREDAJU', otvorene_stavke: 0, ima_podatke: false },
  { id: 'adriatic-logistics', ...pick(hrCompany('Adriatic Logistics Hub d.o.o.', 'Lučka cesta 2', '51000 Rijeka')), djelatnost: 'logistika i skladištenje', vlasnik: 'Baltic Freight Group (NL)', porezno_razdoblje: 'mjesečno', razdoblje: PERIOD.id, rok_prijave: '2026-10-20', status: 'CEKA_PREGLED', otvorene_stavke: 4, ima_podatke: false },
  { id: 'medisol-clinic', ...pick(hrCompany('Medisol Clinic d.o.o.', 'Petrova 63', '10000 Zagreb')), djelatnost: 'zdravstvene usluge', vlasnik: 'Medisol Holding S.p.A. (IT)', porezno_razdoblje: 'mjesečno', razdoblje: PERIOD.id, rok_prijave: '2026-10-20', status: 'CEKA_KLIJENTA', otvorene_stavke: 2, ima_podatke: false },
  { id: 'kvarner-yacht', ...pick(hrCompany('Kvarner Yacht Services d.o.o.', 'Obala Maršala Tita 151', '51410 Opatija')), djelatnost: 'najam plovila', vlasnik: 'Seaborne Charter Ltd (MT)', porezno_razdoblje: 'mjesečno', razdoblje: PERIOD.id, rok_prijave: '2026-10-20', status: 'SPREMNO_ZA_PREDAJU', otvorene_stavke: 0, ima_podatke: false },
];
function pick(c) {
  return { naziv: c.name, oib: c.oib, adresa: `${c.street}, ${c.city}` };
}

// ---------- write everything ----------

rmSync(OUT, { recursive: true, force: true });
const clientDir = join(OUT, 'nordtech-adriatic', PERIOD.id);
for (const d of ['eracuni', 'strani-racuni', 'izlazni-racuni']) mkdirSync(join(clientDir, d), { recursive: true });

const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');

writeJson(join(OUT, 'ured.json'), {
  napomena: 'Svi podaci su izmišljeni (synthetic demo data).',
  ured: pick(firm),
  klijenti: portfolio,
});

for (const i of invoices) {
  if (i.channel === 'eracun') writeFileSync(join(clientDir, 'eracuni', `${fileName(i)}.xml`), invoiceToUbl(i), 'utf8');
}
for (const i of invoices.filter((i) => i.channel === 'pdf')) {
  const dir = i.direction === 'URA' ? 'strani-racuni' : 'izlazni-racuni';
  await writeInvoicePdf(i, join(clientDir, dir, `${fileName(i)}.pdf`));
}

const fmtBook = (rows, cols) => toCsv(rows.map((r) => Object.fromEntries(cols.map((c) => [c, ['osnovica', 'pdv', 'pretporez', 'ukupno'].includes(c) ? toEur(r[c]) : r[c]]))), cols);
writeFileSync(join(clientDir, 'knjiga-ura.csv'), fmtBook(ura, ['rb', 'datum_knjizenja', 'broj_racuna', 'datum_racuna', 'partner', 'oib_ili_vat_id', 'drzava', 'opis', 'vrsta', 'osnovica', 'stopa', 'pdv', 'pretporez', 'ukupno']), 'utf8');
writeFileSync(join(clientDir, 'knjiga-ira.csv'), fmtBook(ira, ['rb', 'broj_racuna', 'datum_racuna', 'partner', 'oib_ili_vat_id', 'drzava', 'opis', 'vrsta', 'osnovica', 'stopa', 'pdv', 'ukupno']), 'utf8');
writeFileSync(join(clientDir, 'bankovni-izvod.csv'), toCsv(bank.map((t) => ({ ...t, iznos: toEur(t.iznos), stanje: toEur(t.stanje) })), ['datum', 'opis', 'protustrana', 'iban_protustrane', 'poziv_na_broj', 'iznos', 'stanje']), 'utf8');
writeFileSync(join(clientDir, 'fiskalizacija-export.csv'), toCsv(fiscal, Object.keys(fiscal[0])), 'utf8');

writeJson(join(clientDir, 'klijent.json'), { ...pick(client), vat_id: client.vatId, iban: client.iban, razdoblje: PERIOD });

const eurDeep = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && k !== 'stopa' ? Number(toEur(v)) : v)));
writeJson(join(clientDir, 'answer_key.json'), {
  napomena: 'Rješenje za validaciju - NE koristi ga aplikacija, samo test. Iznosi u EUR.',
  greske: answerKey.map((e) => ({ ...e, utjecaj_za_uplatu: Number(toEur(e.utjecaj_za_uplatu)) })),
  ocekivano_bankovno: bank.filter((t) => t.category).map((t) => ({ datum: t.datum, opis: t.opis, iznos: Number(toEur(t.iznos)), kategorija: t.category })),
  pdv_tocno: eurDeep(truth),
  pdv_prema_knjigama: eurDeep(asBooked),
  zp_tocno: eurDeep(zpTruth),
  zp_prema_knjigama: eurDeep(zpBooks),
  // What a correct reading of each PDF must return (used to grade the AI extraction).
  pdf_tocno: invoices.filter((i) => i.channel === 'pdf').map((i) => ({
    datoteka: `${i.direction === 'URA' ? 'strani-racuni' : 'izlazni-racuni'}/${fileName(i)}.pdf`,
    broj_racuna: i.number,
    datum_racuna: i.issueDate,
    izdavatelj_vat_id: i.supplier.vatId,
    primatelj_vat_id: i.buyer.vatId,
    vrsta_isporuke: i.treatment === 'EU_STJECANJE_DOBARA' ? 'DOBRA' : 'USLUGA',
    osnovica: Number(toEur(i.netCents)),
    pdv: Number(toEur(i.vatCents)),
    ukupno: Number(toEur(i.grossCents)),
  })),
});

// ---------- summary ----------

const count = (f) => invoices.filter(f).length;
console.log(`Generirano u ${OUT}`);
console.log(`  Klijent: ${client.name} (OIB ${client.oib}), razdoblje ${PERIOD.label}`);
console.log(`  eRacuni (XML): ${count((i) => i.channel === 'eracun')}, strani PDF: ${count((i) => i.channel === 'pdf' && i.direction === 'URA')}, izlazni PDF: ${count((i) => i.channel === 'pdf' && i.direction === 'IRA')}`);
console.log(`  Knjiga URA: ${ura.length} redaka, IRA: ${ira.length}, banka: ${bank.length} transakcija, fiskalizacija: ${fiscal.length}`);
console.log(`  Ubacene greske: ${answerKey.length}`);
console.log(`  PDV za uplatu - prema knjigama: ${toEur(asBooked.za_uplatu)} EUR, tocno: ${toEur(truth.za_uplatu)} EUR (razlika ${toEur(deltaComputed)} EUR)`);
