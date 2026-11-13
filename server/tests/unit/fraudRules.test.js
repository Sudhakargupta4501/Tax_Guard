'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../../services/fraudRules');
const { DEFAULT_THRESHOLDS: th } = require('../../config/fraudConfig');
const { makeInvoice } = require('../helpers/factory');

const configFor = () => ({ rate: 18 });

test('a correctly calculated invoice triggers no arithmetic, tax or info findings', () => {
  const inv = makeInvoice();
  assert.equal(rules.checkIncorrectTotal(inv, th), null);
  assert.equal(rules.checkTaxDiscrepancy(inv, { configFor }, th), null);
  assert.equal(rules.checkMissingInfo(inv, th), null);
});

test('inflated grand total is flagged as INCORRECT_TOTAL only (not double counted as tax issue)', () => {
  const inv = makeInvoice();
  inv.grandTotal += 500;
  const total = rules.checkIncorrectTotal(inv, th);
  assert.equal(total.category, 'INCORRECT_TOTAL');
  assert.match(total.description, /grand total/);
  assert.equal(rules.checkTaxDiscrepancy(inv, { configFor }, th), null);
});

test('understated tax is flagged as TAX_DISCREPANCY with the triggered rule recorded', () => {
  const inv = makeInvoice();
  inv.items[0].taxAmount = 100;
  inv.items[0].cgst = 50;
  inv.items[0].sgst = 50;
  inv.taxBreakdown = { cgst: 50, sgst: 50, igst: 0, totalTax: 100 };
  inv.grandTotal = inv.taxableAmount + 100;
  inv.items[0].lineTotal = inv.items[0].taxableAmount + 100;
  const f = rules.checkTaxDiscrepancy(inv, { configFor }, th);
  assert.equal(f.category, 'TAX_DISCREPANCY');
  assert.ok(f.rules.some((r) => r.ruleId === 'TAX_AMOUNT_MISMATCH'));
  assert.equal(rules.checkIncorrectTotal(inv, th), null);
});

test('rate differing from configuration and wrong supply type are detected', () => {
  const inv = makeInvoice({ stateCode: '07' }); // inter-state, IGST
  const f1 = rules.checkTaxDiscrepancy(inv, { configFor: () => ({ rate: 12 }) }, th);
  assert.ok(f1.rules.some((r) => r.ruleId === 'TAX_RATE_NOT_CONFIGURED'));
  const wrong = makeInvoice({ stateCode: '07' });
  wrong.supplyType = 'intra';
  const f2 = rules.checkTaxDiscrepancy(wrong, { configFor }, th);
  assert.ok(f2.rules.some((r) => r.ruleId === 'SUPPLY_TYPE_MISMATCH'));
});

test('missing information is reported with specific reasons', () => {
  const inv = makeInvoice({ gstin: '', items: [{ name: 'Big', sku: 'B', quantity: 1, unitPrice: 100000, taxRate: 18 }] });
  inv.customerSnapshot.address = '';
  inv.dueDate = undefined;
  inv.amountPaid = 50;
  const f = rules.checkMissingInfo(inv, th);
  assert.equal(f.category, 'MISSING_INFO');
  const issues = f.rules[0].evidence.issues.join(' | ');
  assert.match(issues, /address/);
  assert.match(issues, /due date/);
  assert.match(issues, /GSTIN/);
  assert.match(issues, /outstanding/);
});

test('unusual amount needs enough history and uses a robust z-score', () => {
  const amounts = [1000, 1100, 900, 1050, 950, 1000, 1020, 980, 1010, 990, 1005, 995];
  const stats = rules.medianMad(amounts);
  const normal = makeInvoice({ items: [{ name: 'W', sku: 'W', quantity: 1, unitPrice: 1000, taxRate: 0 }] });
  assert.equal(rules.checkUnusualAmount(normal, stats, th), null);
  const huge = makeInvoice({ items: [{ name: 'W', sku: 'W', quantity: 100, unitPrice: 1000, taxRate: 18 }] });
  const f = rules.checkUnusualAmount(huge, stats, th);
  assert.equal(f.category, 'UNUSUAL_AMOUNT');
  // not enough history -> no judgement
  assert.equal(rules.checkUnusualAmount(huge, rules.medianMad([1000, 1100]), th), null);
});

test('a lone unusual amount stays Low severity (single anomaly is not treated as fraud)', () => {
  const stats = rules.medianMad([1000, 1100, 900, 1050, 950, 1000, 1020, 980, 1010, 990, 1005, 995]);
  const huge = makeInvoice({ items: [{ name: 'W', sku: 'W', quantity: 100, unitPrice: 1000, taxRate: 18 }] });
  const f = rules.checkUnusualAmount(huge, stats, th);
  const s = rules.scoreFinding(f, 1, th);
  assert.equal(s.severity, 'Low');
  assert.ok(s.riskScore < th.mediumSeverityFrom);
});

test('duplicates: same customer/total/items, same number ignoring case, same external reference', () => {
  const a = makeInvoice({ customer: 'c1' });
  const b = makeInvoice({ customer: 'c1', invoiceDate: new Date('2026-09-11T08:00:00Z') });
  const other = makeInvoice({ customer: 'c2', items: [{ name: 'Gadget', sku: 'G', quantity: 5, unitPrice: 77, taxRate: 18 }] });
  const dupes = rules.findDuplicates([a, b, other], th);
  assert.equal(dupes.has(String(b._id)), true);
  assert.equal(dupes.has(String(a._id)), false); // earliest is the original
  assert.equal(dupes.has(String(other._id)), false);
  assert.match(dupes.get(String(b._id)).description, new RegExp(a.invoiceNumber));

  const n1 = makeInvoice({ number: 'INV-9-1', customer: 'x', items: [{ name: 'A', sku: 'A', quantity: 1, unitPrice: 10, taxRate: 5 }] });
  const n2 = makeInvoice({ number: 'inv-9-1 ', customer: 'y', items: [{ name: 'B', sku: 'B', quantity: 1, unitPrice: 20, taxRate: 5 }] });
  assert.equal(rules.findDuplicates([n1, n2], th).has(String(n2._id)), true);

  const e1 = makeInvoice({ customer: 'p', externalReference: 'LEGACY-77', items: [{ name: 'A', sku: 'A', quantity: 1, unitPrice: 11, taxRate: 5 }] });
  const e2 = makeInvoice({ customer: 'q', externalReference: 'legacy-77', items: [{ name: 'B', sku: 'B', quantity: 1, unitPrice: 22, taxRate: 5 }] });
  assert.equal(rules.findDuplicates([e1, e2], th).has(String(e2._id)), true);
});

test('identical invoices far apart in time are not duplicates', () => {
  const a = makeInvoice({ customer: 'c1' });
  const b = makeInvoice({ customer: 'c1', invoiceDate: new Date('2026-10-30T08:00:00Z') });
  assert.equal(rules.findDuplicates([a, b], th).has(String(b._id)), false);
});

test('frequency bursts flag the latest invoice of a busy customer-day', () => {
  const list = Array.from({ length: 6 }, (_, k) => makeInvoice({ customer: 'busy', items: [{ name: `P${k}`, sku: `P${k}`, quantity: 1, unitPrice: 100 + k, taxRate: 18 }] }));
  const bursts = rules.findFrequencyBursts(list, th);
  assert.equal(bursts.size, 1);
  assert.equal(bursts.has(String(list[5]._id)), true);
  assert.equal(rules.findFrequencyBursts(list.slice(0, 4), th).size, 0);
});

test('repeated refunds inside the window are flagged once the threshold is reached', () => {
  const inv = makeInvoice({ customer: 'r1' });
  const byId = new Map([[String(inv._id), inv]]);
  const mk = (id, day) => ({ _id: id, invoice: inv._id, kind: 'refund', amount: 200, paymentDate: new Date(`2026-09-${day}T10:00:00Z`) });
  const refunds = [mk('p1', '01'), mk('p2', '05'), mk('p3', '09')];
  const out = rules.findRepeatedRefunds(refunds, byId, th);
  assert.equal(out.length, 1);
  assert.equal(out[0].finding.category, 'REPEATED_REFUND');
  assert.equal(rules.findRepeatedRefunds(refunds.slice(0, 2), byId, th).length, 0);
  const spread = [mk('a', '01'), { ...mk('b', '01'), paymentDate: new Date('2026-07-01') }, { ...mk('c', '01'), paymentDate: new Date('2026-05-01') }];
  assert.equal(rules.findRepeatedRefunds(spread, byId, th).length, 0);
});

test('monthly reconciliation separates tolerable differences, mismatches and potential under-reporting', () => {
  const inv = makeInvoice({ items: [{ name: 'W', sku: 'W', quantity: 1, unitPrice: 10000, taxRate: 0 }] }); // 10,000 in 2026-09
  const tx = (amount, date = '2026-09-15') => ({ amount, date: new Date(date), direction: 'credit' });
  assert.equal(rules.reconcileMonthly([inv], [tx(10200)], th)[0].flag, null); // 2%
  assert.equal(rules.reconcileMonthly([inv], [tx(10800)], th)[0].flag, 'SALES_RECONCILIATION'); // recorded lower by ~7.4%
  assert.equal(rules.reconcileMonthly([inv], [tx(12000)], th)[0].flag, 'POTENTIAL_UNDER_REPORTING'); // recorded 16.7% lower
  assert.equal(rules.reconcileMonthly([inv], [tx(9000)], th)[0].flag, 'SALES_RECONCILIATION'); // recorded higher
  assert.deepEqual(rules.reconcileMonthly([inv], [], th), []);
  const row = rules.reconcileMonthly([inv], [tx(12000)], th)[0];
  assert.match(rules.reconciliationFinding(row, th).description, /not a finding of under-reporting/);
});

test('payment reference mismatch', () => {
  const f = rules.paymentReferenceMismatch({ transactionReference: 'UTR1', amount: 500 }, { amount: 450 }, { invoiceNumber: 'INV-1' });
  assert.equal(f.category, 'SALES_RECONCILIATION');
  assert.equal(rules.paymentReferenceMismatch({ transactionReference: 'UTR1', amount: 500 }, { amount: 500 }, {}), null);
});

test('scoring: corroboration adds a capped bonus, severity follows configurable thresholds', () => {
  const f = { base: 55, magnitude: 5 };
  assert.equal(rules.scoreFinding(f, 1, th).riskScore, 60);
  assert.equal(rules.scoreFinding(f, 2, th).riskScore, 70);
  assert.equal(rules.scoreFinding(f, 6, th).riskScore, 80); // bonus capped at 20
  assert.equal(rules.scoreFinding({ base: 99, magnitude: 20 }, 3, th).riskScore, 100);
  assert.equal(rules.scoreFinding(f, 2, th).severity, 'High');
  assert.equal(rules.scoreFinding(f, 2, { ...th, highSeverityFrom: 90 }).severity, 'Medium');
  assert.equal(rules.severityFor(10, th), 'Low');
});
