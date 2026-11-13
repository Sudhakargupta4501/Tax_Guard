import { describe, it, expect } from 'vitest';
import { calcInvoice, calcLine } from '../utils/invoiceCalc';

describe('invoice preview calculations', () => {
  it('splits GST into CGST + SGST for intra-state sales', () => {
    const r = calcInvoice([{ quantity: 2, unitPrice: 1000, discountPercent: 10, taxRate: 18 }], true);
    expect(r.subtotal).toBe(2000);
    expect(r.discount).toBe(200);
    expect(r.taxable).toBe(1800);
    expect(r.cgst).toBe(162);
    expect(r.sgst).toBe(162);
    expect(r.igst).toBe(0);
    expect(r.totalTax).toBe(324);
    expect(r.grandTotal).toBe(2124);
  });

  it('uses IGST for inter-state sales', () => {
    const r = calcInvoice([{ quantity: 1, unitPrice: 1000, taxRate: 18 }], false);
    expect(r.igst).toBe(180);
    expect(r.cgst + r.sgst).toBe(0);
    expect(r.grandTotal).toBe(1180);
  });

  it('avoids floating point drift and keeps CGST + SGST equal to total tax', () => {
    const l = calcLine({ quantity: 3, unitPrice: 0.1, taxRate: 5 }, true);
    expect(l.gross).toBe(30); // paise
    const odd = calcLine({ quantity: 1, unitPrice: 0.99, taxRate: 5 }, true);
    expect(odd.cgst + odd.sgst).toBe(odd.tax);
  });

  it('handles empty / invalid input without NaN', () => {
    const r = calcInvoice([{ quantity: '', unitPrice: 'abc', taxRate: undefined }], true);
    expect(r.grandTotal).toBe(0);
    expect(Number.isNaN(r.grandTotal)).toBe(false);
  });
});
