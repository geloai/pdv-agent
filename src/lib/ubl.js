// Minimal UBL 2.1 invoice (EN 16931 core fields) as exchanged under Fiskalizacija 2.0.
// Simplified for demo purposes: no HR-specific extensions, no signatures.
import { toEur } from './util.js';

const xmlEsc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function party(tag, p) {
  return `  <cac:${tag}>
    <cac:Party>
      <cbc:EndpointID schemeID="9934">${xmlEsc(p.vatId)}</cbc:EndpointID>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEsc(p.street)}</cbc:StreetName>
        <cbc:CityName>${xmlEsc(p.city)}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>${p.country}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEsc(p.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEsc(p.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:${tag}>`;
}

export function invoiceToUbl(inv) {
  const byRate = new Map();
  for (const l of inv.lines) {
    const k = `${l.vatCategory}|${l.vatRate}`;
    const cur = byRate.get(k) ?? { cat: l.vatCategory, rate: l.vatRate, net: 0, vat: 0 };
    cur.net += l.netCents;
    cur.vat += l.vatCents;
    byRate.set(k, cur);
  }
  const subtotals = [...byRate.values()]
    .map(
      (s) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${toEur(s.net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${toEur(s.vat)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${s.cat}</cbc:ID>
        <cbc:Percent>${s.rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`
    )
    .join('\n');

  const lines = inv.lines
    .map(
      (l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${toEur(l.netCents)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEsc(l.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${l.vatCategory}</cbc:ID>
        <cbc:Percent>${l.vatRate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${toEur(Math.round(l.netCents / l.qty))}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ID>${xmlEsc(inv.number)}</cbc:ID>
  <cbc:IssueDate>${inv.issueDate}</cbc:IssueDate>
  <cbc:DueDate>${inv.dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>${xmlEsc(inv.note ?? '')}</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:InvoicePeriod><cbc:StartDate>${inv.supplyDate}</cbc:StartDate><cbc:EndDate>${inv.supplyDate}</cbc:EndDate></cac:InvoicePeriod>
${party('AccountingSupplierParty', inv.supplier)}
${party('AccountingCustomerParty', inv.buyer)}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${xmlEsc(inv.supplier.iban ?? '')}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${toEur(inv.vatCents)}</cbc:TaxAmount>
${subtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${toEur(inv.netCents)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${toEur(inv.netCents)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${toEur(inv.grossCents)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${toEur(inv.grossCents)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`;
}
