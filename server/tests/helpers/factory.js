'use strict';
// Database-free factory that builds invoice documents exactly the way invoiceService does.
const tax = require('../../services/taxService');

let counter = 0;

function makeInvoice({
  number,
  customer = 'cust1',
  stateCode = '03',
  supplierStateCode = '03',
  items = [{ name: 'Widget', sku: 'W1', quantity: 2, unitPrice: 1000, discountPercent: 0, taxRate: 18, taxCategory: 'GST-18' }],
  invoiceDate = new Date('2026-09-10T08:00:00Z'),
  gstin = '03ABCDE1234F1Z5',
  amountPaid = 0,
  externalReference,
} = {}) {
  counter += 1;
  const intraState = tax.isIntraState(supplierStateCode, stateCode);
  const lines = items.map((i) => ({ i, calc: tax.computeLine(i, { intraState }) }));
  const totals = tax.totalsToRupees(tax.sumLines(lines.map((l) => l.calc)));
  const grand = totals.grandTotal;
  return {
    _id: `inv${counter}`,
    invoiceNumber: number || `INV-2026-${String(counter).padStart(5, '0')}`,
    externalReference,
    customer,
    customerSnapshot: { name: 'Acme Traders', address: '1 Main Road, Ludhiana', gstin, stateCode },
    supplierStateCode,
    supplyType: intraState ? 'intra' : 'inter',
    items: lines.map(({ i, calc }) => ({ ...i, product: i.sku, grossAmount: calc.gross / 100, ...tax.lineToRupees(calc) })),
    ...totals,
    amountPaid,
    outstanding: Math.round((grand - amountPaid) * 100) / 100,
    invoiceDate,
    dueDate: new Date(invoiceDate.getTime() + 30 * 86400000),
    paymentStatus: amountPaid <= 0 ? 'Unpaid' : amountPaid >= grand ? 'Paid' : 'Partially Paid',
    status: 'Issued',
    createdAt: new Date(invoiceDate.getTime() + counter * 1000),
  };
}

module.exports = { makeInvoice };
