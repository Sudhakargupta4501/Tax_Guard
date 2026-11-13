'use strict';
/**
 * GST calculation (simplified for an academic project).
 *
 * Assumptions:
 *  - Intra-state supply (supplier state code == customer state code): total GST is split equally into CGST + SGST.
 *  - Inter-state supply: the whole amount is charged as IGST.
 *  - Tax is computed per line on (quantity x unit price - discount), rounded half-up to the paisa.
 *  - Rates come from active TaxConfiguration records; nothing is hardcoded here.
 *  - No cess, reverse charge, composition scheme, exports/SEZ or e-invoicing (IRN) logic is modelled.
 * This is NOT a statement of legal tax liability.
 */
const ApiError = require('../utils/ApiError');
const { toPaise, fromPaise, divRound, percentToBp, qtyToMilli } = require('../utils/money');

const isIntraState = (supplierStateCode, customerStateCode) => String(supplierStateCode) === String(customerStateCode);

/**
 * Pure line computation in integer paise.
 * @param {{quantity:number|string, unitPrice:number|string, discountPercent?:number|string, taxRate:number|string}} line
 * @param {{intraState:boolean}} opts
 */
function computeLine(line, { intraState }) {
  const unitPaise = toPaise(line.unitPrice);
  const qtyMilli = qtyToMilli(line.quantity);
  const discountBp = percentToBp(line.discountPercent ?? 0);
  const rateBp = percentToBp(line.taxRate);

  const gross = divRound(unitPaise * qtyMilli, 1000);
  const discount = divRound(gross * discountBp, 10000);
  const taxable = gross - discount;
  const tax = divRound(taxable * rateBp, 10000);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState) {
    cgst = Math.floor(tax / 2);
    sgst = tax - cgst; // odd paisa goes to SGST so cgst + sgst === tax exactly
  } else {
    igst = tax;
  }
  return { gross, discount, taxable, cgst, sgst, igst, tax, total: taxable + tax };
}

/** Aggregates computed lines (integer paise) into invoice totals. */
function sumLines(lines) {
  const t = lines.reduce(
    (a, l) => ({
      subtotal: a.subtotal + l.gross,
      discount: a.discount + l.discount,
      taxable: a.taxable + l.taxable,
      cgst: a.cgst + l.cgst,
      sgst: a.sgst + l.sgst,
      igst: a.igst + l.igst,
      tax: a.tax + l.tax,
      grand: a.grand + l.total,
    }),
    { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, grand: 0 }
  );
  return t;
}

/** Converts paise-based line/total objects to rupee numbers for storage/display. */
function lineToRupees(l) {
  return {
    grossAmount: fromPaise(l.gross),
    discountAmount: fromPaise(l.discount),
    taxableAmount: fromPaise(l.taxable),
    cgst: fromPaise(l.cgst),
    sgst: fromPaise(l.sgst),
    igst: fromPaise(l.igst),
    taxAmount: fromPaise(l.tax),
    lineTotal: fromPaise(l.total),
  };
}

function totalsToRupees(t) {
  return {
    subtotal: fromPaise(t.subtotal),
    discount: fromPaise(t.discount),
    taxableAmount: fromPaise(t.taxable),
    taxBreakdown: { cgst: fromPaise(t.cgst), sgst: fromPaise(t.sgst), igst: fromPaise(t.igst), totalTax: fromPaise(t.tax) },
    grandTotal: fromPaise(t.grand),
  };
}

/** Finds the active tax configuration effective on `date` for a category. */
async function resolveTaxConfig(category, date = new Date()) {
  const TaxConfiguration = require('../models/TaxConfiguration'); // lazy: keeps pure calculation functions DB-free
  const cfg = await TaxConfiguration.findOne({ category, isActive: true, effectiveDate: { $lte: date } }).sort({ effectiveDate: -1 }).lean();
  if (!cfg) {
    throw ApiError.unprocessable(`No active tax configuration found for category "${category}". Ask an administrator to configure it.`);
  }
  return cfg;
}

module.exports = { isIntraState, computeLine, sumLines, lineToRupees, totalsToRupees, resolveTaxConfig };
