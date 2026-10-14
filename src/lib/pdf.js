// Renders foreign (non-eRačun) invoices as PDFs, the way they arrive by email.
// These are what the AI layer has to read in phase 4.
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { toEur } from './util.js';

export function writeInvoicePdf(inv, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const out = createWriteStream(filePath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.pipe(out);

    const s = inv.supplier;
    const b = inv.buyer;
    doc.fontSize(18).text(s.name, { continued: false });
    doc.fontSize(9).fillColor('#555').text(`${s.street}, ${s.city}, ${s.countryName}`).text(`VAT ID: ${s.vatId}`);
    doc.moveDown(1.5).fillColor('#000').fontSize(16).text('INVOICE');
    doc.moveDown(0.5).fontSize(10);
    doc.text(`Invoice no.: ${inv.number}`);
    doc.text(`Invoice date: ${inv.issueDate}`);
    doc.text(`Service / delivery date: ${inv.supplyDate}`);
    doc.text(`Due date: ${inv.dueDate}`);

    doc.moveDown(1).fontSize(10).text('Bill to:', { underline: true });
    doc.text(b.name).text(`${b.street}, ${b.city}, ${b.countryName}`).text(`VAT ID: ${b.vatId}`);

    doc.moveDown(1.5);
    const top = doc.y;
    doc.font('Helvetica-Bold').text('Description', 50, top).text('Qty', 330, top).text('Net (EUR)', 400, top);
    doc.text('VAT', 490, top);
    doc.font('Helvetica');
    let y = top + 18;
    for (const l of inv.lines) {
      doc.text(l.description, 50, y, { width: 270 });
      doc.text(String(l.qty), 330, y).text(toEur(l.netCents), 400, y).text(`${l.vatRate}%`, 490, y);
      y += 30;
    }
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 10;
    doc.text('Net total:', 330, y).text(`${toEur(inv.netCents)} EUR`, 430, y);
    doc.text('VAT:', 330, y + 15).text(`${toEur(inv.vatCents)} EUR`, 430, y + 15);
    doc.font('Helvetica-Bold').text('Total due:', 330, y + 30).text(`${toEur(inv.grossCents)} EUR`, 430, y + 30);
    doc.font('Helvetica');

    if (inv.legalNote) {
      doc.moveDown(3).fontSize(9).fillColor('#333').text(inv.legalNote, 50, y + 70, { width: 495 });
    }
    doc.fontSize(8).fillColor('#777').text(`Bank: ${s.iban ?? ''}`, 50, 760);
    doc.end();
  });
}
