'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, login, seedBasics } = require('../helpers/app');
const Invoice = require('../../models/Invoice');

let owner;
let acct;
let reviewer;
let base;

test.before(async () => {
  await startDb();
  owner = await login('business_owner');
  acct = await login('accountant');
  reviewer = await login('reviewer');
  base = await seedBasics(owner.user);
});
test.after(stopDb);

const newInvoice = async (qty = 1, customer = base.customerLocal) =>
  (await acct.post('/api/invoices', { customerId: String(customer._id), items: [{ productId: String(base.widget._id), quantity: qty }] })).body.data;

test('a correct invoice raises no arithmetic or tax alerts', async () => {
  const inv = await newInvoice(2);
  const alerts = (await reviewer.get(`/api/fraud-alerts?invoice=${inv._id}`)).body.data;
  assert.ok(!alerts.some((a) => ['INCORRECT_TOTAL', 'TAX_DISCREPANCY'].includes(a.category)));
});

test('tampered grand total is detected as INCORRECT_TOTAL with an explanation and rule version', async () => {
  const inv = await newInvoice(3, base.customerOther);
  await Invoice.updateOne({ _id: inv._id }, { $inc: { grandTotal: 400, outstanding: 400 } });
  const run = await reviewer.post('/api/fraud-alerts/analyze', { invoiceId: inv._id });
  assert.equal(run.status, 200);
  const list = (await reviewer.get(`/api/fraud-alerts?invoice=${inv._id}&category=INCORRECT_TOTAL`)).body.data;
  assert.equal(list.length, 1);
  const detail = (await reviewer.get(`/api/fraud-alerts/${list[0]._id}`)).body.data;
  assert.match(detail.alert.alertId, /^FA-\d{6}$/);
  assert.equal(detail.alert.reviewStatus, 'New');
  assert.equal(detail.alert.detectionMethod, 'rule-based');
  assert.match(detail.alert.detectionVersion, /^rules-/);
  assert.ok(detail.alert.riskScore >= 0 && detail.alert.riskScore <= 100);
  assert.ok(detail.alert.triggeredRules.length >= 1);
  assert.match(detail.alert.description, /grand total/i);
});

test('understated tax is detected as TAX_DISCREPANCY', async () => {
  const inv = await newInvoice(4);
  const lower = inv.taxBreakdown.totalTax / 2;
  await Invoice.updateOne({ _id: inv._id }, { $set: { 'items.0.taxAmount': lower, 'items.0.cgst': lower / 2, 'items.0.sgst': lower / 2, 'items.0.lineTotal': inv.taxableAmount + lower, 'taxBreakdown.cgst': lower / 2, 'taxBreakdown.sgst': lower / 2, 'taxBreakdown.totalTax': lower, grandTotal: inv.taxableAmount + lower, outstanding: inv.taxableAmount + lower } });
  await reviewer.post('/api/fraud-alerts/analyze', { invoiceId: inv._id });
  const list = (await reviewer.get(`/api/fraud-alerts?invoice=${inv._id}&category=TAX_DISCREPANCY`)).body.data;
  assert.equal(list.length, 1);
});

test('duplicate invoices (same customer, items, total) are flagged on the later invoice only', async () => {
  const first = await newInvoice(7, base.customerLocal);
  const second = await newInvoice(7, base.customerLocal);
  await reviewer.post('/api/fraud-alerts/analyze', {});
  const onSecond = (await reviewer.get(`/api/fraud-alerts?invoice=${second._id}&category=DUPLICATE_INVOICE`)).body.data;
  const onFirst = (await reviewer.get(`/api/fraud-alerts?invoice=${first._id}&category=DUPLICATE_INVOICE`)).body.data;
  assert.equal(onSecond.length, 1);
  assert.equal(onFirst.length, 0);
  // re-running analysis never creates a second alert for the same issue
  await reviewer.post('/api/fraud-alerts/analyze', {});
  assert.equal((await reviewer.get(`/api/fraud-alerts?invoice=${second._id}&category=DUPLICATE_INVOICE`)).body.data.length, 1);
});

test('review workflow: permissions, required reasons, valid transitions and history', async () => {
  const alert = (await reviewer.get('/api/fraud-alerts?category=DUPLICATE_INVOICE')).body.data[0];
  const url = `/api/fraud-alerts/${alert._id}/review`;

  assert.equal((await acct.patch(url, { reviewStatus: 'Under Review' })).status, 403); // accountants cannot review
  assert.equal((await reviewer.patch(url, {})).status, 400); // nothing to update
  assert.equal((await reviewer.patch(url, { reviewStatus: 'False Positive' })).status, 400); // reason required

  const under = await reviewer.patch(url, { reviewStatus: 'Under Review', comment: 'Checking with the customer' });
  assert.equal(under.status, 200);
  assert.equal(under.body.data.reviewStatus, 'Under Review');
  assert.equal(under.body.data.reviewComments.length, 1);

  const fp = await reviewer.patch(url, { reviewStatus: 'False Positive', resolutionNotes: 'Customer confirmed two separate orders.' });
  assert.equal(fp.body.data.reviewStatus, 'False Positive');
  assert.equal(fp.body.data.resolutionNotes, 'Customer confirmed two separate orders.');
  assert.ok(fp.body.data.history.length >= 3);

  // closed alerts cannot jump straight to another closed state, and are never deleted
  assert.equal((await reviewer.patch(url, { reviewStatus: 'Resolved', resolutionNotes: 'x' })).status, 409);
  assert.equal((await reviewer.delete(`/api/fraud-alerts/${alert._id}`)).status, 404);

  // a reviewed (identical-evidence) alert is not resurrected by re-analysis
  await reviewer.post('/api/fraud-alerts/analyze', {});
  const again = await reviewer.get(`/api/fraud-alerts/${alert._id}`);
  assert.equal(again.body.data.alert.reviewStatus, 'False Positive');
  const logs = await owner.get('/api/audit-logs?action=fraud.review');
  assert.ok(logs.body.data.length >= 2);
});

test('fixing the underlying record auto-resolves the stale alert and keeps its history', async () => {
  const inv = await newInvoice(2, base.customerOther);
  await Invoice.updateOne({ _id: inv._id }, { $inc: { grandTotal: 100, outstanding: 100 } });
  await reviewer.post('/api/fraud-alerts/analyze', { invoiceId: inv._id });
  const a = (await reviewer.get(`/api/fraud-alerts?invoice=${inv._id}&category=INCORRECT_TOTAL`)).body.data[0];
  assert.ok(a);
  await Invoice.updateOne({ _id: inv._id }, { $inc: { grandTotal: -100, outstanding: -100 } });
  await reviewer.post('/api/fraud-alerts/analyze', { invoiceId: inv._id });
  const after = (await reviewer.get(`/api/fraud-alerts/${a._id}`)).body.data.alert;
  assert.equal(after.reviewStatus, 'Resolved');
  assert.match(after.resolutionNotes, /Auto-resolved/);
});

test('repeated refunds across a customer are flagged', async () => {
  for (let i = 1; i <= 3; i += 1) {
    const inv = await newInvoice(i + 10, base.customerOther);
    await acct.post('/api/payments', { invoiceId: inv._id, amount: inv.grandTotal, method: 'UPI' });
    await acct.post('/api/payments', { invoiceId: inv._id, kind: 'refund', amount: 100 + i, method: 'UPI' });
  }
  await reviewer.post('/api/fraud-alerts/analyze', {});
  assert.ok((await reviewer.get('/api/fraud-alerts?category=REPEATED_REFUND')).body.data.length >= 1);
});

test('reconciliation against supplied transaction records flags a monthly difference', async () => {
  const month = new Date();
  const imp = await acct.post('/api/fraud-alerts/transactions', { source: 'test', records: [{ reference: 'STMT-1', date: month.toISOString(), amount: 9999999, direction: 'credit' }] });
  assert.equal(imp.status, 201);
  await reviewer.post('/api/fraud-alerts/analyze', {});
  const cats = (await reviewer.get('/api/fraud-alerts?limit=100')).body.data.map((a) => a.category);
  assert.ok(cats.includes('POTENTIAL_UNDER_REPORTING') || cats.includes('SALES_RECONCILIATION'));
  assert.equal((await reviewer.post('/api/fraud-alerts/transactions', { records: [] })).status, 403);
});

test('fraud report aggregates and ML availability is reported without breaking the core', async () => {
  const rep = await owner.get('/api/reports/fraud');
  assert.equal(rep.status, 200);
  assert.ok(rep.body.data.total >= 1);
  assert.match(rep.body.data.notice, /not probabilities/i);
  const meta = await reviewer.get('/api/fraud-alerts/meta');
  assert.equal(meta.body.data.ml.available, false);
  const withMl = await owner.post('/api/fraud-alerts/analyze', { includeMl: true });
  assert.equal(withMl.status, 200);
  assert.equal(withMl.body.data.ml.available, false);
});

test('settings: thresholds validate and tax configuration is admin-only', async () => {
  const admin = await login('admin');
  assert.equal((await admin.put('/api/settings/fraud-thresholds', { mediumSeverityFrom: 80, highSeverityFrom: 60 })).status, 400);
  assert.equal((await admin.put('/api/settings/fraud-thresholds', { mediumSeverityFrom: 30, highSeverityFrom: 60 })).status, 200);
  assert.equal((await owner.put('/api/settings/fraud-thresholds', { mediumSeverityFrom: 30 })).status, 403);
  const cfg = await admin.post('/api/tax-config', { name: 'Test 3%', rate: 3, category: 'GST-3' });
  assert.equal(cfg.status, 201);
  assert.equal((await admin.post('/api/tax-config', { name: 'Dup', rate: 4, category: 'GST-3', effectiveDate: cfg.body.data.effectiveDate })).status, 409);
});
