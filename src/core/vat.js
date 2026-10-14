// VAT return and EC Sales List (ZP) totals computed from book rows.
// Rows use the book shape: { vrsta, osnovica, stopa, pdv, pretporez, oib_ili_vat_id } with amounts in cents.
//
// Simplified model of the Croatian PDV obrazac: the keys below are grouped by meaning,
// not by official line numbers (those are mapped in the UI and must be verified by a tax expert).

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'EL', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

export function vatTotals(uraRows, iraRows) {
  const t = {
    isporuke_tuzemne_25: { osnovica: 0, pdv: 0 },
    usluge_u_eu: { osnovica: 0 },
    ostale_oslobodjene: { osnovica: 0 },
    primljene_usluge_eu_25: { osnovica: 0, pdv: 0 },
    stjecanje_dobara_eu_25: { osnovica: 0, pdv: 0 },
    pretporez_tuzemni: { 25: 0, 13: 0, 5: 0 },
    pretporez_eu_usluge: 0,
    pretporez_eu_stjecanje: 0,
  };
  for (const r of iraRows) {
    if (r.vrsta === 'TUZEMNO') {
      t.isporuke_tuzemne_25.osnovica += r.osnovica;
      t.isporuke_tuzemne_25.pdv += r.pdv;
    } else if (r.vrsta === 'EU_USLUGA') t.usluge_u_eu.osnovica += r.osnovica;
    else t.ostale_oslobodjene.osnovica += r.osnovica;
  }
  for (const r of uraRows) {
    if (r.vrsta === 'TUZEMNO') t.pretporez_tuzemni[r.stopa] = (t.pretporez_tuzemni[r.stopa] ?? 0) + r.pretporez;
    else if (r.vrsta === 'EU_USLUGA_PPO') {
      t.primljene_usluge_eu_25.osnovica += r.osnovica;
      t.primljene_usluge_eu_25.pdv += r.pdv;
      t.pretporez_eu_usluge += r.pretporez;
    } else if (r.vrsta === 'EU_STJECANJE_DOBARA') {
      t.stjecanje_dobara_eu_25.osnovica += r.osnovica;
      t.stjecanje_dobara_eu_25.pdv += r.pdv;
      t.pretporez_eu_stjecanje += r.pretporez;
    }
  }
  const obveza = t.isporuke_tuzemne_25.pdv + t.primljene_usluge_eu_25.pdv + t.stjecanje_dobara_eu_25.pdv;
  const pretporez =
    Object.values(t.pretporez_tuzemni).reduce((s, v) => s + v, 0) + t.pretporez_eu_usluge + t.pretporez_eu_stjecanje;
  t.ukupna_obveza = obveza;
  t.ukupni_pretporez = pretporez;
  t.za_uplatu = obveza - pretporez;
  return t;
}

export function zpTotals(iraRows) {
  const m = {};
  for (const r of iraRows.filter((r) => r.vrsta === 'EU_USLUGA')) {
    m[r.oib_ili_vat_id] = (m[r.oib_ili_vat_id] ?? 0) + r.osnovica;
  }
  return Object.entries(m).map(([vat_id, usluge]) => ({ vat_id, usluge }));
}
