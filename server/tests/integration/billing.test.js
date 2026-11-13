'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, login, seedBasics } = require('../helpers/app');

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

test('customer CRUD with validation, duplicate email handling and archive-on-delete', async () => {
  const bad = await acct.post('/api/customers', { name: 'X', stateCode: '99999' });
  assert.equal(bad.status, 400);
  const badGstin = await acct.post('/api/customers', { name: 'Gst Co', stateCode: '03', gstin: '07AAAPD3333C1Z5' });
  assert.equal(badGstin.status, 400); // GSTIN state prefix must match state code

  const created = await acct.post('/api/customers', { name: 'Crud Customer', email: 'crud@example.test', stateCode: '03', phone: '9876543210' });
  assert.equal(created.status, 201);
  const id = created.body.data._id;
  assert.equal((await acct.post('/api/customers', { name: 'Crud Dup', email: 'crud@example.test', stateCode: '03' })).status, 409);
  assert.equal((await acct.put(`/api/customers/${id}`, { name: 'Crud Customer 2', email: 'crud@example.test', stateCode: '03' })).body.data.name, 'Crud Customer 2');
  assert.equal((await acct.get(`/api/customers/${id}`)).status, 200);
  assert.equal((await reviewer.get('/api/customers?search=Crud')).body.data.length, 1);
  assert.equal((await acct.delete(`/api/customers/${id}`)).status, 403); // accountants cannot delete
  assert.equal((await owner.delete(`/api/customers/${id}`)).body.data.deleted, true);
  assert.equal((await acct.get(`/api/customers/${id}`)).status, 404);
  assert.equal((await acct.get('/api/customers/xyz')).status, 400);
});

test('product CRUD, unique SKU and price validation', async () => {
  const p = await acct.post('/api/products', { name: 'Gadget', sku: 'gdg-1', unitPrice: 250.5, taxCategory: 'GST-12', taxRate: 12, trackInventory: true, inventoryQuantity: 10 });
  assert.equal(p.status, 201);
  assert.equal(p.body.data.sku, 'GDG-1');
  assert.equal((await acct.post('/api/products', { name: 'Gadget 2', sku: 'GDG-1', unitPrice: 1, taxCategory: 'GST-12', taxRate: 12 })).status, 409);
  assert.equal((await acct.post('/api/products', { name: 'Neg', sku: 'NEG-1', unitPrice: -5, taxCategory: 'GST-12', taxRate: 12 })).status, 400);
  const upd = await acct.put(`/api/products/${p.body.data._id}`, { name: 'Gadget', sku: 'GDG-1', unitPrice: 300, taxCategory: 'GST-12', taxRate: 12 });
  assert.equal(upd.body.data.unitPrice, 300);
});

test('intra-state invoice splits GST into CGST + SGST and ignores client-supplied totals', async () => {
  const res = await acct.post('/api/invoices', {
    customerId: String(base.customerLocal._id),
    items: [{ productId: String(base.widget._id), quantity: 2 }],
    grandTotal: 1, taxBreakdown: { totalTax: 0 }, status: 'Paid', amountPaid: 99999, // must all be stripped
  });
  assert.equal(res.status, 201);
  const inv = res.body.data;
  assert.match(inv.invoiceNumber, /^INV-\d{4}-\d{5}$/);
  assert.equal(inv.subtotal, 2000);
  assert.equal(inv.taxableAmount, 2000);
  assert.deepEqual([inv.taxBreakdown.cgst, inv.taxBreakdown.sgst, inv.taxBreakdown.igst], [180, 180, 0]);
  assert.equal(inv.grandTotal, 2360);
  assert.equal(inv.amountPaid, 0);
  assert.equal(inv.paymentStatus, 'Unpaid');
  assert.equal(inv.supplyType, 'intra');
});

test('inter-state invoice uses IGST, applies discounts and paise-safe rounding', async () => {
  const res = await acct.post('/api/invoices', { customerId: String(base.customerOther._id), items: [{ productId: String(base.widget._id), quantity: 3, discountPercent: 10 }] });
  assert.equal(res.status, 201);
  const inv = res.body.data;
  assert.equal(inv.discount, 300);
  assert.equal(inv.taxableAmount, 2700);
  assert.deepEqual([inv.taxBreakdown.cgst, inv.taxBreakdown.sgst, inv.taxBreakdown.igst], [0, 0, 486]);
  assert.equal(inv.grandTotal, 3186);
  assert.equal(inv.supplyType, 'inter');
});

test('invoice creation is validated and permission-protected', async () => {
  assert.equal((await acct.post('/api/invoices', { customerId: String(base.customerLocal._id), items: [] })).status, 400);
  assert.equal((await acct.post('/api/invoices', { customerId: 'bad', items: [{ productId: String(base.widget._id), quantity: 1 }] })).status, 400);
  assert.equal((await acct.post('/api/invoices', { customerId: String(base.customerLocal._id), items: [{ productId: String(base.widget._id), quantity: -1 }] })).status, 400);
  assert.equal((await reviewer.post('/api/invoices', { customerId: String(base.customerLocal._id), items: [{ productId: String(base.widget._id), quantity: 1 }] })).status, 403);
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  assert.equal((await acct.post('/api/invoices', { customerId: String(base.customerLocal._id), invoiceDate: future, items: [{ productId: String(base.widget._id), quantity: 1 }] })).status, 400);
});

test('payments: partial -> paid, overpayment and duplicate submission rejected, refunds tracked', async () => {
  const inv = (await acct.post('/api/invoices', { customerId: String(base.customerLocal._id), items: [{ productId: String(base.widget._id), quantity: 1 }] })).body.data; // 1180
  const pay = (amount, extra = {}) => acct.post('/api/payments', { invoiceId: inv._id, amount, method: 'UPI', ...extra });

  const first = await pay(500);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.invoice.paymentStatus, 'Partially Paid');
  assert.equal(first.body.data.invoice.outstanding, 680);
  assert.equal(first.body.data.payment.verified, false); // manual entry, not bank verified

  assert.equal((await pay(500)).status, 409); // identical submission within seconds -> duplicate guard
  assert.equal((await pay(700, { method: 'Cash' })).status, 409); // exceeds the outstanding 680
  const last = await pay(680, { method: 'Cash' });
  assert.equal(last.body.data.invoice.paymentStatus, 'Paid');
  assert.equal(last.body.data.invoice.outstanding, 0);

  const refund = await acct.post('/api/payments', { invoiceId: inv._id, kind: 'refund', amount: 100, method: 'UPI' });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.data.invoice.paymentStatus, 'Partially Paid');
  assert.equal((await acct.post('/api/payments', { invoiceId: inv._id, kind: 'refund', amount: 5000, method: 'UPI' })).status, 409);

  // payments are append-only: no update/delete routes exist
  const id = last.body.data.payment._id;
  assert.equal((await acct.put(`/api/payments/${id}`, { amount: 1 })).status, 404);
  assert.equal((await acct.delete(`/api/payments/${id}`)).status, 404);
  assert.equal((await acct.get(`/api/payments?invoice=${inv._id}`)).body.data.length, 3);
});

test('invoice list filters, detail view, edit-before-payment and audit trail', async () => {
  const list = await acct.get('/api/invoices?paymentStatus=Unpaid&limit=100');
  assert.equal(list.status, 200);
  assert.ok(list.body.pagination.total >= 2);
  assert.ok(list.body.data.every((i) => i.paymentStatus === 'Unpaid'));
  const byNumber = await acct.get(`/api/invoices?search=${list.body.data[0].invoiceNumber}`);
  assert.equal(byNumber.body.data.length, 1);

  const target = list.body.data[0];
  const detail = await acct.get(`/api/invoices/${target._id}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.body.data.alerts));

  const edit = await acct.put(`/api/invoices/${target._id}`, { items: [{ productId: String(base.widget._id), quantity: 5 }] });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.data.subtotal, 5000);
  assert.equal(edit.body.data.outstanding, edit.body.data.grandTotal);

  const logs = await owner.get('/api/audit-logs?entityType=Invoice');
  const actions = logs.body.data.map((l) => l.action);
  assert.ok(actions.includes('invoice.create') && actions.includes('invoice.update'));
  assert.equal((await acct.get('/api/audit-logs')).status, 403);
  assert.equal(JSON.stringify(logs.body).includes('passwordHash'), false);
});

test('only owner/admin can cancel, with a reason, and not after payments', async () => {
  const inv = (await acct.post('/api/invoices', { customerId: String(base.customerLocal._id), items: [{ productId: String(base.widget._id), quantity: 1 }] })).body.data;
  assert.equal((await acct.put(`/api/invoices/${inv._id}`, { status: 'Cancelled', cancelReason: 'Mistake' })).status, 403);
  assert.equal((await owner.put(`/api/invoices/${inv._id}`, { status: 'Cancelled' })).status, 400);
  const done = await owner.put(`/api/invoices/${inv._id}`, { status: 'Cancelled', cancelReason: 'Entered by mistake' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, 'Cancelled');
  assert.equal((await acct.post('/api/payments', { invoiceId: inv._id, amount: 10, method: 'Cash' })).status, 409);
});

test('invoice PDF downloads as a real PDF', async () => {
  const list = await acct.get('/api/invoices?limit=1');
  const id = list.body.data[0]._id;
  const res = await acct.agent.get(`/api/invoices/${id}/pdf`).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.equal(res.body.subarray(0, 4).toString(), '%PDF');
  assert.equal((await acct.get('/api/invoices/not-an-id/pdf')).status, 400);
});

test('report summary matches the stored invoices', async () => {
  const sum = await owner.get('/api/reports/summary');
  assert.equal(sum.status, 200);
  const all = await owner.get('/api/invoices?status=Issued&limit=100');
  const expected = all.body.data.reduce((a, i) => a + i.taxableAmount, 0);
  assert.equal(Math.round(sum.body.data.cards.totalSales * 100), Math.round(expected * 100));
  assert.equal(sum.body.data.cards.totalInvoices, all.body.pagination.total);
  const csv = await owner.agent.get('/api/reports/tax?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
});
