/**
 * Client-side invoice PREVIEW. It mirrors the server's integer-paise, round-half-up logic so the numbers
 * shown while typing match what the server will store - but the server always recalculates and is the
 * source of truth (rates come from the tax configuration there, never from the browser).
 */
const toPaise = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100);
};
// integer division rounded half-up (non-negative inputs)
const divRound = (num, den) => Math.floor((2 * num + den) / (2 * den));
const bp = (pct) => Math.round((Number(pct) || 0) * 100);

export function calcLine({ quantity, unitPrice, discountPercent = 0, taxRate = 0 }, intraState) {
  const qtyMilli = Math.round((Number(quantity) || 0) * 1000);
  const gross = divRound(toPaise(unitPrice) * qtyMilli, 1000);
  const discount = divRound(gross * bp(discountPercent), 10000);
  const taxable = gross - discount;
  const tax = divRound(taxable * bp(taxRate), 10000);
  const cgst = intraState ? Math.floor(tax / 2) : 0;
  const sgst = intraState ? tax - cgst : 0;
  const igst = intraState ? 0 : tax;
  return { gross, discount, taxable, tax, cgst, sgst, igst, total: taxable + tax };
}

export function calcInvoice(lines, intraState) {
  const calc = lines.map((l) => calcLine(l, intraState));
  const sum = (k) => calc.reduce((a, l) => a + l[k], 0);
  const r = (p) => p / 100;
  return {
    lines: calc.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, r(v)]))),
    subtotal: r(sum('gross')),
    discount: r(sum('discount')),
    taxable: r(sum('taxable')),
    cgst: r(sum('cgst')),
    sgst: r(sum('sgst')),
    igst: r(sum('igst')),
    totalTax: r(sum('tax')),
    grandTotal: r(sum('total')),
  };
}
