// Deterministic VAT reconciliation for one client and one period.
//
// Compares the client's books (URA/IRA) with fiscalized eRačuni and the bank statement,
// applies VAT rules and returns findings. Every finding carries a proposed correction, so the
// engine can show both the VAT return "as booked" and "after corrections", and the effect of
// each finding on the amount payable. No AI here: amounts and matching are plain code.
import { vatTotals, zpTotals, EU_COUNTRIES } from './vat.js';
import { toHrAmount } from '../lib/util.js';

const eur = (c) => `${toHrAmount(c)} €`;
const keyOf = (partnerId, broj) => `${partnerId}|${broj}`;
const SEVERITY_RANK = { red: 3, orange: 2, info: 1, green: 0 };

const CAR = /osobn[a-zčćšđž]*\s+vozil/i;
const ENTERTAINMENT = /reprezentacij|poslovni ručak|poslovni rucak/i;

const BANK_CATEGORIES = [
  [/isplata plać|isplata plac/i, 'PLAĆE'],
  [/joppd|doprinos|porez na dohodak/i, 'POREZI I DOPRINOSI'],
  [/uplata pdv/i, 'POREZI I DOPRINOSI'],
  [/naknada za vođenje|naknada za vodenje|bankovna naknada/i, 'BANKOVNA NAKNADA'],
];

export function loadPeriod(db, clientId, period) {
  const all = (sql) => db.prepare(sql).all(clientId, period).map((r) => ({ ...r }));
  return {
    client: { ...db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) },
    ura: all("SELECT * FROM book_entries WHERE client_id = ? AND period = ? AND knjiga = 'URA' ORDER BY rb"),
    ira: all("SELECT * FROM book_entries WHERE client_id = ? AND period = ? AND knjiga = 'IRA' ORDER BY rb"),
    fiscal: all("SELECT * FROM documents WHERE client_id = ? AND period = ? AND source = 'FISKALIZACIJA'"),
    eracuni: all("SELECT * FROM documents WHERE client_id = ? AND period = ? AND source = 'ERACUN'"),
    pdfs: all("SELECT * FROM documents WHERE client_id = ? AND period = ? AND source = 'PDF'"),
    bank: all('SELECT * FROM bank_tx WHERE client_id = ? AND period = ? ORDER BY datum, id'),
  };
}

function periodBounds(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` };
}

// ---------- corrections ----------

function applyCorrections(data, corrections) {
  const books = { URA: data.ura.map((r) => ({ ...r })), IRA: data.ira.map((r) => ({ ...r })) };
  for (const c of corrections) {
    if (!c) continue;
    if (c.type === 'add') books[c.knjiga].push({ ...c.row });
    else {
      const i = books[c.knjiga].findIndex((r) => r.id === c.rowId);
      if (i < 0) continue;
      if (c.type === 'remove') books[c.knjiga].splice(i, 1);
      else Object.assign(books[c.knjiga][i], c.set);
    }
  }
  return books;
}

const totalsOf = (books) => ({ pdv: vatTotals(books.URA, books.IRA), zp: zpTotals(books.IRA) });

// ---------- engine ----------

export function reconcile(data, period) {
  const { start, end } = periodBounds(period);
  const findings = [];
  const add = (f) => findings.push({ zahtjev_klijentu: false, dokazi: [], ispravak: null, ...f });
  const handled = new Set(); // book row ids already explained by a structural finding

  const eracunByKey = new Map(data.eracuni.map((d) => [keyOf(d.partner_id, d.broj_racuna), d]));
  const fiscalIn = data.fiscal.filter((d) => d.smjer === 'ULAZNI');
  const fiscalOut = data.fiscal.filter((d) => d.smjer === 'IZLAZNI');
  const fiscalByKey = new Map(data.fiscal.map((d) => [`${d.smjer}|${keyOf(d.partner_id, d.broj_racuna)}`, d]));

  // 1. Duplicates (same partner + invoice number booked more than once)
  for (const [knjiga, rows] of [['URA', data.ura], ['IRA', data.ira]]) {
    const groups = new Map();
    for (const r of rows) {
      const k = keyOf(r.oib_ili_vat_id, r.broj_racuna);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [first, ...dups] = group;
      for (const d of dups) {
        handled.add(d.id);
        add({
          kod: 'DUPLI_RACUN', ozbiljnost: 'red', knjiga, rowId: d.id, broj_racuna: d.broj_racuna, partner: d.partner,
          naslov: `Račun ${d.broj_racuna} proknjižen dva puta`,
          detalji: `Isti dobavljač, broj i iznos (${eur(d.ukupno)}) u knjizi ${knjiga} pod rednim brojevima ${first.rb} i ${d.rb}.`,
          dokazi: [{ vrsta: 'knjiga', rb: first.rb }, { vrsta: 'knjiga', rb: d.rb }],
          ispravak: { type: 'remove', knjiga, rowId: d.id },
        });
      }
    }
  }

  // 2. Invoice date outside the period
  for (const [knjiga, rows] of [['URA', data.ura], ['IRA', data.ira]]) {
    for (const r of rows) {
      if (handled.has(r.id) || (r.datum_racuna >= start && r.datum_racuna <= end)) continue;
      handled.add(r.id);
      const later = r.datum_racuna > end;
      add({
        kod: 'RACUN_IZVAN_RAZDOBLJA', ozbiljnost: 'orange', knjiga, rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
        naslov: `Račun ${r.broj_racuna} ne pripada razdoblju`,
        detalji: `Datum računa ${r.datum_racuna} je ${later ? 'nakon' : 'prije'} razdoblja ${start} – ${end}. ` +
          (knjiga === 'URA' ? `Pretporez ${eur(r.pretporez)} ${later ? 'pripada sljedećem razdoblju' : 'treba provjeriti'}.` : ''),
        ispravak: { type: 'remove', knjiga, rowId: r.id },
      });
    }
  }

  // 3. Domestic purchases vs. fiscalized eRačuni
  const bookedInKeys = new Set(data.ura.map((r) => keyOf(r.oib_ili_vat_id, r.broj_racuna)));
  for (const r of data.ura) {
    if (handled.has(r.id) || r.drzava !== 'HR') continue;
    const fis = fiscalByKey.get(`ULAZNI|${keyOf(r.oib_ili_vat_id, r.broj_racuna)}`);
    if (!fis) {
      handled.add(r.id);
      add({
        kod: 'URA_BEZ_FISKALIZIRANOG_ERACUNA', ozbiljnost: 'red', knjiga: 'URA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
        naslov: `Nema eRačuna za račun ${r.broj_racuna}`,
        detalji: `Račun je proknjižen s pretporezom ${eur(r.pretporez)}, ali ne postoji među zaprimljenim fiskaliziranim eRačunima. ` +
          'U tuzemnom B2B prometu od 1. 1. 2026. pretporez se priznaje samo uz eRačun. Pretporez treba isključiti dok dobavljač ne izda eRačun.',
        zahtjev_klijentu: true,
        ispravak: { type: 'update', knjiga: 'URA', rowId: r.id, set: { pretporez: 0 } },
      });
      continue;
    }
    const doc = eracunByKey.get(keyOf(r.oib_ili_vat_id, r.broj_racuna)) ?? fis;
    if (doc.osnovica !== r.osnovica || doc.pdv !== r.pdv) {
      handled.add(r.id);
      const ratio = r.pdv ? r.pretporez / r.pdv : 1;
      const rate = doc.stope ? JSON.parse(doc.stope)[0]?.stopa : r.stopa;
      const pay = data.bank.find((t) => t.poziv_na_broj.includes(r.broj_racuna) && -t.iznos === doc.ukupno);
      add({
        kod: 'IZNOS_RAZLICIT_OD_ERACUNA', ozbiljnost: 'orange', knjiga: 'URA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
        naslov: `Iznos u knjizi ne odgovara eRačunu ${r.broj_racuna}`,
        detalji: `Knjiga: osnovica ${eur(r.osnovica)}, PDV ${eur(r.pdv)}. eRačun: osnovica ${eur(doc.osnovica)}, PDV ${eur(doc.pdv)}.` +
          (pay ? ` Plaćanje u banci ${pay.datum} (${eur(-pay.iznos)}) potvrđuje iznos s eRačuna.` : ''),
        dokazi: [{ vrsta: 'eracun', datoteka: doc.datoteka }, ...(pay ? [{ vrsta: 'banka', datum: pay.datum, iznos: pay.iznos }] : [])],
        ispravak: { type: 'update', knjiga: 'URA', rowId: r.id,
          set: { osnovica: doc.osnovica, pdv: doc.pdv, ukupno: doc.ukupno, stopa: rate, pretporez: Math.round(doc.pdv * ratio) } },
      });
    }
  }
  for (const f of fiscalIn) {
    if (bookedInKeys.has(keyOf(f.partner_id, f.broj_racuna))) continue;
    const doc = eracunByKey.get(keyOf(f.partner_id, f.broj_racuna));
    const rate = doc?.stope ? JSON.parse(doc.stope)[0]?.stopa : 25;
    add({
      kod: 'ERACUN_NIJE_PROKNJIZEN', ozbiljnost: 'orange', knjiga: 'URA', broj_racuna: f.broj_racuna, partner: f.partner,
      naslov: `eRačun ${f.broj_racuna} nije proknjižen`,
      detalji: `Zaprimljeni eRačun od ${f.datum_racuna} (osnovica ${eur(f.osnovica)}, PDV ${eur(f.pdv)}) nije u knjizi URA. ` +
        'Pretporez nije iskorišten. Prijedlog: proknjižiti uz puni odbitak, uz provjeru namjene troška.',
      dokazi: [{ vrsta: 'eracun', datoteka: f.datoteka }],
      ispravak: { type: 'add', knjiga: 'URA', row: {
        broj_racuna: f.broj_racuna, datum_racuna: f.datum_racuna, partner: f.partner, oib_ili_vat_id: f.partner_id, drzava: 'HR',
        vrsta: 'TUZEMNO', osnovica: f.osnovica, stopa: rate, pdv: f.pdv, pretporez: f.pdv, ukupno: f.ukupno } },
    });
  }

  // 4. Domestic sales vs. fiscalization
  const bookedOutKeys = new Set(data.ira.map((r) => keyOf(r.oib_ili_vat_id, r.broj_racuna)));
  for (const f of fiscalOut) {
    if (bookedOutKeys.has(keyOf(f.partner_id, f.broj_racuna))) continue;
    add({
      kod: 'IZLAZNI_ERACUN_NIJE_PROKNJIZEN', ozbiljnost: 'red', knjiga: 'IRA', broj_racuna: f.broj_racuna, partner: f.partner,
      naslov: `Izlazni eRačun ${f.broj_racuna} nije u knjizi IRA`,
      detalji: `Fiskalizirani izlazni eRačun (PDV ${eur(f.pdv)}) nije iskazan. Porezna uprava ga vidi, pa će prijava odstupati.`,
      ispravak: { type: 'add', knjiga: 'IRA', row: {
        broj_racuna: f.broj_racuna, datum_racuna: f.datum_racuna, partner: f.partner, oib_ili_vat_id: f.partner_id, drzava: 'HR',
        vrsta: 'TUZEMNO', osnovica: f.osnovica, stopa: 25, pdv: f.pdv, ukupno: f.ukupno } },
    });
  }
  for (const r of data.ira) {
    if (handled.has(r.id) || r.drzava !== 'HR' || r.vrsta !== 'TUZEMNO') continue;
    if (fiscalByKey.has(`IZLAZNI|${keyOf(r.oib_ili_vat_id, r.broj_racuna)}`)) continue;
    add({
      kod: 'IZLAZNI_RACUN_NIJE_FISKALIZIRAN', ozbiljnost: 'red', knjiga: 'IRA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
      naslov: `Izlazni račun ${r.broj_racuna} nije fiskaliziran`,
      detalji: 'Račun je u knjizi IRA, ali ga nema u fiskalizacijskim podacima. Treba ga izdati kao eRačun i fiskalizirati.',
    });
  }

  // 5. EU purchases must be self-assessed (reverse charge / intra-EU acquisition)
  for (const r of data.ura) {
    if (handled.has(r.id) || !EU_COUNTRIES.has(r.drzava)) continue;
    if (r.vrsta === 'EU_USLUGA_PPO' || r.vrsta === 'EU_STJECANJE_DOBARA') continue;
    const vat = Math.round(r.osnovica * 0.25);
    add({
      kod: 'EU_USLUGA_BEZ_PRIJENOSA_POREZNE_OBVEZE', ozbiljnost: 'red', knjiga: 'URA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
      naslov: `Račun iz EU (${r.drzava}) bez obračuna PDV-a`,
      detalji: `${r.partner} je porezni obveznik iz ${r.drzava}. Primatelj mora sam obračunati PDV 25 % (${eur(vat)}) i ` +
        'istodobno ga odbiti kao pretporez. Na iznos za uplatu nema utjecaja, ali PDV obrazac i PDV-S su netočni. ' +
        'Pretpostavka: usluga (ne isporuka dobara) — potvrditi iz računa.',
      ispravak: { type: 'update', knjiga: 'URA', rowId: r.id, set: { vrsta: 'EU_USLUGA_PPO', stopa: 25, pdv: vat, pretporez: vat } },
    });
  }

  // 6. Sales to EU customers must be reported as EU services (and in the ZP form)
  for (const r of data.ira) {
    if (handled.has(r.id) || !EU_COUNTRIES.has(r.drzava)) continue;
    if (r.vrsta === 'EU_USLUGA') continue;
    add({
      kod: 'EU_USLUGA_KRIVO_KLASIFICIRANA', ozbiljnost: 'red', knjiga: 'IRA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
      naslov: `Usluga kupcu iz EU krivo razvrstana (${r.broj_racuna})`,
      detalji: `Kupac ${r.partner} (${r.oib_ili_vat_id}) je porezni obveznik iz ${r.drzava}, a račun je razvrstan kao "${r.vrsta}". ` +
        `Usluga se iskazuje kao obavljena u EU i mora biti u ZP obrascu (osnovica ${eur(r.osnovica)}).`,
      ispravak: { type: 'update', knjiga: 'IRA', rowId: r.id, set: { vrsta: 'EU_USLUGA', stopa: 0, pdv: 0 } },
    });
  }

  // 7. Input VAT limits: passenger cars 50 %, entertainment 0 %
  for (const r of data.ura) {
    if (handled.has(r.id) || r.vrsta !== 'TUZEMNO') continue;
    const text = `${r.opis} ${r.partner}`;
    if (ENTERTAINMENT.test(text) && r.pretporez > 0) {
      add({
        kod: 'REPREZENTACIJA_PRETPOREZ', ozbiljnost: 'orange', knjiga: 'URA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
        naslov: `Pretporez na reprezentaciju (${r.broj_racuna})`,
        detalji: `Trošak "${r.opis}" je reprezentacija, za koju se pretporez ne priznaje. Proknjiženo ${eur(r.pretporez)}, treba 0,00 €.`,
        ispravak: { type: 'update', knjiga: 'URA', rowId: r.id, set: { pretporez: 0 } },
      });
    } else if (CAR.test(text) && r.pretporez > Math.round(r.pdv / 2)) {
      const allowed = Math.round(r.pdv / 2);
      add({
        kod: 'OSOBNO_VOZILO_PRETPOREZ_100', ozbiljnost: 'orange', knjiga: 'URA', rowId: r.id, broj_racuna: r.broj_racuna, partner: r.partner,
        naslov: `Osobno vozilo: pretporez veći od 50 % (${r.broj_racuna})`,
        detalji: `Za troškove osobnih vozila priznaje se 50 % pretporeza. Proknjiženo ${eur(r.pretporez)}, dopušteno ${eur(allowed)}.`,
        ispravak: { type: 'update', knjiga: 'URA', rowId: r.id, set: { pretporez: allowed } },
      });
    }
  }

  // 8. Bank statement
  const allRows = [...data.ura.map((r) => ({ ...r, knjiga: 'URA' })), ...data.ira.map((r) => ({ ...r, knjiga: 'IRA' }))];
  const bankStatus = data.bank.map((t) => {
    const cat = BANK_CATEGORIES.find(([re]) => re.test(t.opis));
    if (cat) return { ...t, status: 'green', kategorija: cat[1] };
    const outflow = t.iznos < 0;
    const knjiga = outflow ? 'URA' : 'IRA';
    const ref = t.poziv_na_broj.replace(/^HR\d{2}\s*/, '').trim();
    const byRef = ref && allRows.find((r) => r.knjiga === knjiga && r.broj_racuna === ref);
    // A payment reference wins over amount matching: same partner + same amount can be a different invoice.
    const byAmount = !ref && allRows.find((r) => r.knjiga === knjiga && r.ukupno === Math.abs(t.iznos) && namesMatch(r.partner, t.protustrana));
    const match = byRef || byAmount;
    if (match) return { ...t, status: 'green', kategorija: 'RAČUN', racun: match.broj_racuna };
    const fis = ref && data.fiscal.find((d) => d.broj_racuna === ref);
    if (fis) return { ...t, status: 'green', kategorija: 'RAČUN', racun: fis.broj_racuna };
    if (!outflow && ref) return { ...t, status: 'info', kategorija: 'PRETHODNO RAZDOBLJE', racun: ref };
    if (outflow) {
      add({
        kod: 'PLACANJE_BEZ_RACUNA', ozbiljnost: 'orange', knjiga: 'BANKA', broj_racuna: null, partner: t.protustrana,
        naslov: `Plaćanje bez računa: ${t.protustrana}`,
        detalji: `Isplata ${eur(-t.iznos)} dana ${t.datum} („${t.opis}”) nema računa ni u knjigama ni u eRačunima. ` +
          'Ako je riječ o predujmu, dobavljač treba izdati račun za predujam (PDV se obračunava pri primitku predujma).',
        zahtjev_klijentu: true,
        dokazi: [{ vrsta: 'banka', datum: t.datum, iznos: t.iznos, opis: t.opis }],
      });
      return { ...t, status: 'orange', kategorija: 'BEZ RAČUNA' };
    }
    return { ...t, status: 'orange', kategorija: 'NEPOZNATA UPLATA' };
  });

  // ---------- totals and effects ----------

  const booked = totalsOf({ URA: data.ura, IRA: data.ira });
  const corrected = totalsOf(applyCorrections(data, findings.map((f) => f.ispravak)));
  for (const f of findings) {
    f.utjecaj_za_uplatu = f.ispravak
      ? totalsOf(applyCorrections(data, [f.ispravak])).pdv.za_uplatu - booked.pdv.za_uplatu
      : 0;
  }
  findings.sort((a, b) => SEVERITY_RANK[b.ozbiljnost] - SEVERITY_RANK[a.ozbiljnost]);

  const rowStatus = (knjiga, r) => {
    const fs = findings.filter((f) => f.knjiga === knjiga && f.rowId === r.id);
    const worst = fs.reduce((w, f) => (SEVERITY_RANK[f.ozbiljnost] > SEVERITY_RANK[w] ? f.ozbiljnost : w), 'green');
    return { ...r, status: worst, nalazi: fs.map((f) => f.kod) };
  };

  const summary = {
    nalaza: findings.length,
    crveno: findings.filter((f) => f.ozbiljnost === 'red').length,
    narancasto: findings.filter((f) => f.ozbiljnost === 'orange').length,
    zahtjeva_klijentu: findings.filter((f) => f.zahtjev_klijentu).length,
    zeleno_redaka: [...data.ura.map((r) => rowStatus('URA', r)), ...data.ira.map((r) => rowStatus('IRA', r))].filter((r) => r.status === 'green').length,
    ukupno_redaka: data.ura.length + data.ira.length,
    za_uplatu_prema_knjigama: booked.pdv.za_uplatu,
    za_uplatu_nakon_ispravaka: corrected.pdv.za_uplatu,
  };

  return {
    summary,
    findings,
    ura: data.ura.map((r) => rowStatus('URA', r)),
    ira: data.ira.map((r) => rowStatus('IRA', r)),
    bank: bankStatus,
    totals: { prema_knjigama: booked, nakon_ispravaka: corrected },
  };
}

function namesMatch(a, b) {
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/d\.o\.o\.|d\.d\./g, '').trim();
  const x = norm(a), y = norm(b);
  return Boolean(x && y && (x.includes(y) || y.includes(x) || x.split(/\s+/)[0] === y.split(/\s+/)[0]));
}

// Runs the reconciliation, stores the run + findings and updates the period status.
export function runReconciliation(db, clientId, period) {
  const result = reconcile(loadPeriod(db, clientId, period), period);
  db.exec('BEGIN');
  try {
    const run = db.prepare('INSERT INTO runs (client_id, period, started_at, summary) VALUES (?, ?, ?, ?)')
      .run(clientId, period, new Date().toISOString(), JSON.stringify(result.summary));
    const runId = Number(run.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO findings (run_id, client_id, period, kod, ozbiljnost, knjiga, broj_racuna, partner, naslov, detalji,
      utjecaj_za_uplatu, zahtjev_klijentu, dokazi, ispravak) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of result.findings) {
      ins.run(runId, clientId, period, f.kod, f.ozbiljnost, f.knjiga, f.broj_racuna, f.partner, f.naslov, f.detalji,
        f.utjecaj_za_uplatu, f.zahtjev_klijentu ? 1 : 0, JSON.stringify(f.dokazi), JSON.stringify(f.ispravak));
    }
    const s = result.summary;
    const status = s.zahtjeva_klijentu ? 'CEKA_KLIJENTA' : s.nalaza ? 'CEKA_PREGLED' : 'SPREMNO_ZA_PREDAJU';
    db.prepare('UPDATE periods SET status = ?, otvorene_stavke = ? WHERE client_id = ? AND period = ?').run(status, s.nalaza, clientId, period);
    db.exec('COMMIT');
    return { runId, ...result };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
