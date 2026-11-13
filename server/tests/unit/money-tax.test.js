'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toPaise, fromPaise, divRound, percentToBp, qtyToMilli } = require('../../utils/money');
const tax = require('../../services/taxService');

test('toPaise parses decimals without floating point drift', () => {
  assert.equal(toPaise('0.1') + toPaise('0.2'), toPaise('0.3'));
  assert.equal(toPaise(19.99), 1999);
  assert.equal(toPaise('1.005'), 101); // half-up
  assert.equal(toPaise('1.004'), 100);
  assert.equal(toPaise(0), 0);
  assert.equal(toPaise('-2.50'), -250);
  assert.throws(() => toPaise('abc'));
  assert.throws(() => toPaise(''));
  assert.throws(() => toPaise(NaN));
});

test('fromPaise / divRound / bp helpers', () => {
  assert.equal(fromPaise(12345), 123.45);
  assert.equal(divRound(5, 2), 3);
  assert.equal(divRound(4, 3), 1);
  assert.equal(divRound(-5, 2), -3);
  assert.equal(percentToBp(18), 1800);
  assert.equal(percentToBp('2.5'), 250);
  assert.equal(qtyToMilli('1.5'), 1500);
});

test('intra-state line: CGST + SGST equal total tax and odd paisa goes to SGST', () => {
  const l = tax.computeLine({ quantity: 3, unitPrice: 999.99, discountPercent: 0, taxRate: 18 }, { intraState: true });
  assert.equal(l.gross, 299997);
  assert.equal(l.tax, 53999); // 2999.97 * 18% = 539.9946 -> 539.99
  assert.equal(l.cgst + l.sgst, l.tax);
  assert.equal(l.cgst, 26999);
  assert.equal(l.sgst, 27000);
  assert.equal(l.igst, 0);
  assert.equal(l.total, l.taxable + l.tax);
});

test('inter-state line charges IGST only', () => {
  const l = tax.computeLine({ quantity: 1, unitPrice: 1000, taxRate: 12 }, { intraState: false });
  assert.equal(l.igst, 12000);
  assert.equal(l.cgst, 0);
  assert.equal(l.sgst, 0);
});

test('discount reduces taxable value before tax', () => {
  const l = tax.computeLine({ quantity: 2, unitPrice: 500, discountPercent: 10, taxRate: 5 }, { intraState: true });
  assert.equal(l.gross, 100000);
  assert.equal(l.discount, 10000);
  assert.equal(l.taxable, 90000);
  assert.equal(l.tax, 4500);
});

test('invoice totals are the exact sum of lines', () => {
  const lines = [
    tax.computeLine({ quantity: 1, unitPrice: 33.33, taxRate: 18 }, { intraState: true }),
    tax.computeLine({ quantity: 3, unitPrice: 10.01, taxRate: 5 }, { intraState: true }),
  ];
  const t = tax.sumLines(lines);
  assert.equal(t.grand, lines[0].total + lines[1].total);
  assert.equal(t.tax, t.cgst + t.sgst + t.igst);
  const r = tax.totalsToRupees(t);
  assert.equal(r.grandTotal, t.grand / 100);
});

test('zero-rated and fractional quantity lines', () => {
  const z = tax.computeLine({ quantity: 1.5, unitPrice: 100, taxRate: 0 }, { intraState: true });
  assert.equal(z.gross, 15000);
  assert.equal(z.tax, 0);
});

test('isIntraState compares state codes', () => {
  assert.equal(tax.isIntraState('03', '03'), true);
  assert.equal(tax.isIntraState('03', '07'), false);
});
