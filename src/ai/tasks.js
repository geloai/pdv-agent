// The three things Claude does in this system. None of them produces amounts that go into the
// VAT return: extracted invoice data is cross-checked by deterministic code, and explanations
// and emails are drafts for the accountant to approve.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askJson, pdfBlock } from './client.js';
import { toHrAmount } from '../lib/util.js';

const RULES = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pravila-pdv.md'), 'utf8');
const RULE_IDS = [...RULES.matchAll(/^## (R-[A-Z-]+)/gm)].map((m) => m[1]);

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// ---------- 1. Read a foreign invoice PDF ----------

const INVOICE_SCHEMA = obj({
  broj_racuna: str,
  datum_racuna: { type: 'string', description: 'YYYY-MM-DD' },
  izdavatelj: str,
  izdavatelj_vat_id: str,
  izdavatelj_drzava: { type: 'string', description: 'ISO 3166-1 alpha-2' },
  primatelj: str,
  primatelj_vat_id: str,
  opis: str,
  vrsta_isporuke: { type: 'string', enum: ['USLUGA', 'DOBRA', 'MIJESANO'] },
  osnovica: num,
  pdv: num,
  ukupno: num,
  valuta: str,
  prijenos_porezne_obveze: { type: 'boolean', description: 'true if the invoice states reverse charge / VAT exemption for intra-EU supply' },
  napomena_o_pdv: { type: 'string', description: 'the VAT note printed on the invoice, verbatim, or empty' },
});

export async function readInvoicePdf(path) {
  const { data, usage, cached } = await askJson({
    task: 'invoice',
    effort: 'low',
    system:
      'You extract data from invoices for an accounting firm. Copy numbers, dates and identifiers exactly as printed. ' +
      'Amounts are plain numbers in the invoice currency. Classify the supply as USLUGA (services), DOBRA (goods) or MIJESANO. ' +
      'If a field is not on the invoice, return an empty string (or 0 for amounts). Do not infer missing values.',
    content: [pdfBlock(path), { type: 'text', text: 'Extract the invoice data.' }],
    schema: INVOICE_SCHEMA,
  });
  return { data, usage, cached };
}

// ---------- 2. Explain findings for the accountant ----------

const REVIEW_SCHEMA = obj({
  nalazi: {
    type: 'array',
    items: obj({
      indeks: { type: 'integer' },
      objasnjenje: { type: 'string', description: '2-3 sentences in Croatian, plain language' },
      preporuka: { type: 'string', description: 'one concrete next step for the accountant, in Croatian' },
      pravilo_id: { type: 'string', enum: [...RULE_IDS, 'NEMA'] },
      sigurnost: { type: 'string', enum: ['visoka', 'srednja', 'niska'] },
      treba_strucnu_provjeru: { type: 'boolean' },
    }),
  },
});

export async function explainFindings({ client, period, findings }) {
  const list = findings.map((f, i) => ({
    indeks: i,
    kod: f.kod,
    ozbiljnost: f.ozbiljnost,
    naslov: f.naslov,
    detalji: f.detalji,
    utjecaj_na_pdv_za_uplatu: `${toHrAmount(f.utjecaj_za_uplatu)} €`,
    dokazi: f.dokazi,
  }));
  const { data, usage, cached } = await askJson({
    task: 'review',
    effort: 'medium',
    system:
      'You assist accountants at a Croatian accounting firm who prepare monthly VAT returns for client companies. ' +
      'A deterministic reconciliation engine has already found the issues below and computed every amount; never change or recompute amounts. ' +
      'For each finding write, in Croatian: a short plain-language explanation of what is wrong and why it matters, and one concrete next step. ' +
      'Ground the explanation only in the rules provided and cite the matching rule id; if no rule covers it, use NEMA and mark it for expert review. ' +
      'Set sigurnost to how certain the finding is given the evidence (e.g. a keyword-based classification is less certain than a document mismatch). ' +
      'Mark treba_strucnu_provjeru when the outcome depends on facts the documents do not show.\n\n<pravila>\n' + RULES + '\n</pravila>',
    content: [{
      type: 'text',
      text: `Klijent: ${client.naziv} (${client.djelatnost}; vlasnik ${client.vlasnik}). Razdoblje: ${period}.\n\n` +
        `<nalazi>\n${JSON.stringify(list, null, 2)}\n</nalazi>`,
    }],
    schema: REVIEW_SCHEMA,
  });
  return { data, usage, cached };
}

// ---------- 3. Draft the request to the client ----------

const EMAIL_SCHEMA = obj({ hr: obj({ predmet: str, tijelo: str }), en: obj({ predmet: str, tijelo: str }) });

export async function draftClientRequest({ client, period, firm, findings }) {
  const items = findings.map((f) => ({
    dobavljac: f.partner, broj_racuna: f.broj_racuna, naslov: f.naslov, detalji: f.detalji, dokazi: f.dokazi,
  }));
  const { data, usage, cached } = await askJson({
    task: 'email',
    effort: 'low',
    system:
      `You write emails on behalf of the accounting firm ${firm} to a client's finance contact. ` +
      'The email asks the client for the documents or clarifications needed to finish the monthly VAT return. ' +
      'Be brief, polite and specific: one numbered item per request that always names the supplier, plus invoice number, amount and date where known, and what exactly is needed. ' +
      'State the filing deadline. No legal lecture, no internal jargon (no rule ids, no finding codes). ' +
      'Write one version in Croatian and one in English. Sign as "Računovodstveni tim" / "Accounting team". Plain text, no markdown.',
    content: [{
      type: 'text',
      text: `Klijent: ${client.naziv}. Razdoblje: ${period}. Rok za predaju PDV prijave: ${client.rok_prijave}.\n\n` +
        `<zahtjevi>\n${JSON.stringify(items, null, 2)}\n</zahtjevi>`,
    }],
    schema: EMAIL_SCHEMA,
  });
  return { data, usage, cached };
}
