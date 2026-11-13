'use strict';
const PDFDocument = require('pdfkit');
const { formatINR } = require('../utils/money');

const fmt = (n) => formatINR(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-');

const COLS = [
  { key: 'n', label: '#', x: 40, w: 22, align: 'left' },
  { key: 'name', label: 'Item', x: 62, w: 170, align: 'left' },
  { key: 'qty', label: 'Qty', x: 232, w: 40, align: 'right' },
  { key: 'rate', label: 'Rate', x: 272, w: 62, align: 'right' },
  { key: 'disc', label: 'Disc %', x: 334, w: 42, align: 'right' },
  { key: 'taxable', label: 'Taxable', x: 376, w: 70, align: 'right' },
  { key: 'gst', label: 'GST %', x: 446, w: 36, align: 'right' },
  { key: 'total', label: 'Amount', x: 482, w: 73, align: 'right' },
];

/** Streams an invoice PDF into `stream` (an HTTP response). Amounts are shown as "INR" to stay font-safe. */
function renderInvoicePdf(invoice, business, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: business.name } });
  doc.pipe(stream);

  // Header
  doc.font('Helvetica-Bold').fontSize(18).text(business.name, 40, 40);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  if (business.address) doc.text(business.address, 40, doc.y, { width: 260 });
  if (business.gstin) doc.text(`GSTIN: ${business.gstin}`);
  if (business.email || business.phone) doc.text([business.email, business.phone].filter(Boolean).join('  |  '));

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', 340, 40, { width: 215, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#333');
  const meta = [
    ['Invoice No.', invoice.invoiceNumber],
    ['Invoice Date', fmtDate(invoice.invoiceDate)],
    ['Due Date', fmtDate(invoice.dueDate)],
    ['Status', `${invoice.status} / ${invoice.paymentStatus}`],
    ['Supply', invoice.supplyType === 'intra' ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'],
  ];
  let y = 62;
  meta.forEach(([k, v]) => {
    doc.font('Helvetica-Bold').text(`${k}:`, 340, y, { width: 80 });
    doc.font('Helvetica').text(String(v), 420, y, { width: 135, align: 'right' });
    y += 13;
  });

  // Bill to
  doc.fillColor('#000');
  const billY = Math.max(doc.y, 135) + 8;
  doc.moveTo(40, billY).lineTo(555, billY).strokeColor('#cccccc').stroke();
  doc.font('Helvetica-Bold').fontSize(9).text('BILL TO', 40, billY + 8);
  const c = invoice.customerSnapshot || {};
  doc.font('Helvetica-Bold').fontSize(11).text(c.name || '-', 40, billY + 22);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  if (c.address) doc.text(c.address, 40, doc.y, { width: 300 });
  if (c.email) doc.text(c.email);
  doc.text(`GSTIN: ${c.gstin || 'Not provided (unregistered / consumer)'}   State code: ${c.stateCode || '-'}`);

  // Table
  const header = (yy) => {
    doc.rect(40, yy, 515, 18).fill('#1e293b');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    COLS.forEach((col) => doc.text(col.label, col.x + 2, yy + 5, { width: col.w - 4, align: col.align }));
    doc.fillColor('#000');
    return yy + 22;
  };
  let ty = header(doc.y + 14);
  doc.font('Helvetica').fontSize(8.5);
  invoice.items.forEach((it, i) => {
    const nameH = doc.heightOfString(it.name + (it.description ? `\n${it.description}` : ''), { width: COLS[1].w - 4 });
    const rowH = Math.max(16, nameH + 6);
    if (ty + rowH > 740) {
      doc.addPage();
      ty = header(40);
      doc.font('Helvetica').fontSize(8.5);
    }
    const row = {
      n: String(i + 1), qty: String(it.quantity), rate: fmt(it.unitPrice), disc: it.discountPercent ? `${it.discountPercent}` : '-',
      taxable: fmt(it.taxableAmount), gst: `${it.taxRate}`, total: fmt(it.lineTotal),
    };
    COLS.forEach((col) => {
      if (col.key === 'name') {
        doc.font('Helvetica-Bold').text(it.name, col.x + 2, ty + 3, { width: col.w - 4 });
        if (it.description) doc.font('Helvetica').fillColor('#666').fontSize(7.5).text(it.description, col.x + 2, doc.y, { width: col.w - 4 }).fillColor('#000').fontSize(8.5);
        doc.font('Helvetica');
      } else doc.text(row[col.key], col.x + 2, ty + 3, { width: col.w - 4, align: col.align });
    });
    ty += rowH;
    doc.moveTo(40, ty).lineTo(555, ty).strokeColor('#e5e7eb').stroke();
  });

  // Totals
  if (ty + 170 > 780) { doc.addPage(); ty = 40; }
  ty += 12;
  const bd = invoice.taxBreakdown || {};
  const lines = [['Subtotal', invoice.subtotal], ['Discount', -invoice.discount], ['Taxable amount', invoice.taxableAmount]];
  if (invoice.supplyType === 'intra') lines.push(['CGST', bd.cgst], ['SGST', bd.sgst]);
  else lines.push(['IGST', bd.igst]);
  lines.push(['Total tax', bd.totalTax]);
  doc.fontSize(9).font('Helvetica');
  lines.forEach(([k, v]) => {
    doc.text(k, 350, ty, { width: 110 });
    doc.text(`INR ${fmt(v)}`, 460, ty, { width: 95, align: 'right' });
    ty += 14;
  });
  doc.moveTo(350, ty).lineTo(555, ty).strokeColor('#999').stroke();
  ty += 6;
  doc.font('Helvetica-Bold').fontSize(11).text('Grand total', 350, ty, { width: 110 }).text(`INR ${fmt(invoice.grandTotal)}`, 460, ty, { width: 95, align: 'right' });
  ty += 20;
  doc.font('Helvetica').fontSize(9).text('Amount paid', 350, ty, { width: 110 }).text(`INR ${fmt(invoice.amountPaid)}`, 460, ty, { width: 95, align: 'right' });
  ty += 14;
  doc.font('Helvetica-Bold').text('Outstanding', 350, ty, { width: 110 }).text(`INR ${fmt(invoice.outstanding)}`, 460, ty, { width: 95, align: 'right' });

  if (invoice.notes) doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(`Notes: ${invoice.notes}`, 40, ty - 40, { width: 280 });

  doc.fillColor('#777').font('Helvetica-Oblique').fontSize(7.5).text(
    'Computer-generated invoice from TaxGuard AI, an educational billing and fraud-risk project. GST values are calculated under simplified assumptions and do not constitute tax advice or a statement of compliance.',
    40, 785, { width: 515, align: 'center' }
  );
  doc.end();
  return doc;
}

module.exports = { renderInvoicePdf };
