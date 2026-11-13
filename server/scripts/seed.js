'use strict';
/**
 * DEVELOPMENT-ONLY demo data. Every record is SYNTHETIC (fictional businesses, invented amounts).
 *   SEED_PASSWORD='Demo-Passw0rd' npm run seed          (add --reset to wipe existing data first)
 * Demo users (password = SEED_PASSWORD, which you supply - nothing is hardcoded):
 *   admin@demo.taxguard.test, owner@demo.taxguard.test, accountant@demo.taxguard.test, reviewer@demo.taxguard.test
 * The data deliberately contains: normal invoices, an incorrect total, a tax discrepancy, a duplicate,
 * a repeated external reference, an unusual amount, repeated refunds and unreconciled monthly sales.
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDatabase } = require('../config/database');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const FraudAlert = require('../models/FraudAlert');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const TransactionRecord = require('../models/TransactionRecord');
const Setting = require('../models/Setting');
const v = require('../validators/schemas');
const invoiceService = require('../services/invoiceService');
const { recordPayment } = require('../services/paymentService');
const fraud = require('../services/fraudDetectionService');
const rules = require('../services/fraudRules');
const { ensureDefaultTaxConfigs } = require('./defaultTax');

const DAY = 86400000;
let seedState = 42;
const rnd = () => { seedState = (seedState * 1664525 + 1013904223) % 4294967296; return seedState / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const daysAgo = (n) => new Date(Date.now() - n * DAY - 3 * 3600 * 1000);

async function main() {
  if (env.isProd && process.env.ALLOW_SEED !== 'true') throw new Error('Refusing to seed in production (set ALLOW_SEED=true only for a throw-away database).');
  const pw = v.register.shape.password.safeParse(process.env.SEED_PASSWORD);
  if (!pw.success) throw new Error(`SEED_PASSWORD is required and must be strong: ${pw.error.issues[0].message}`);
  await connectDatabase();

  if (process.argv.includes('--reset')) {
    // AuditLog is append-only through Mongoose, so use the raw collection for this explicit dev reset.
    await Promise.all([User, Customer, Product, Invoice, Payment, FraudAlert, Counter, TransactionRecord, Setting].map((m) => m.deleteMany({})));
    await AuditLog.collection.deleteMany({});
    console.log('Existing data removed (--reset).');
  } else if (await Invoice.estimatedDocumentCount()) {
    throw new Error('Database already has invoices. Re-run with --reset to wipe and re-seed (development databases only).');
  }

  const hash = await bcrypt.hash(process.env.SEED_PASSWORD, env.BCRYPT_ROUNDS);
  const mk = (name, email, role) => User.create({ name, email, role, passwordHash: hash });
  const admin = await mk('Demo Admin', 'admin@demo.taxguard.test', 'admin');
  const owner = await mk('Demo Owner', 'owner@demo.taxguard.test', 'business_owner');
  const accountant = await mk('Demo Accountant', 'accountant@demo.taxguard.test', 'accountant');
  await mk('Demo Reviewer', 'reviewer@demo.taxguard.test', 'reviewer');
  await ensureDefaultTaxConfigs(admin._id);

  const businessState = env.BUSINESS_STATE_CODE;
  const cust = (name, email, stateCode, state, city, gstin) => ({ name, email, stateCode, gstin, phone: `98${Math.floor(10000000 + rnd() * 89999999)}`, address: { line1: `${Math.floor(1 + rnd() * 99)} Demo Street`, city, state, pincode: '141001' }, createdBy: accountant._id });
  const customers = await Customer.insertMany([
    cust('Sample Traders Pvt Ltd (demo)', 'accounts@sample-traders.test', businessState, 'Punjab', 'Ludhiana', `${businessState}AAAPD1111A1Z5`),
    cust('Fictional Foods LLP (demo)', 'billing@fictional-foods.test', businessState, 'Punjab', 'Amritsar', `${businessState}AAAPD2222B1Z5`),
    cust('Imaginary Infotech (demo)', 'finance@imaginary-infotech.test', '07', 'Delhi', 'New Delhi', '07AAAPD3333C1Z5'),
    cust('Placeholder Pharma Ltd (demo)', 'ap@placeholder-pharma.test', '27', 'Maharashtra', 'Mumbai', '27AAAPD4444D1Z5'),
    cust('Walk-in Customer A (demo)', 'walkin-a@example.test', businessState, 'Punjab', 'Jalandhar', undefined),
    cust('Test Textiles (demo)', 'orders@test-textiles.test', '29', 'Karnataka', 'Bengaluru', '29AAAPD5555E1Z5'),
  ]);
  const prod = (name, sku, unitPrice, taxCategory, taxRate, extra = {}) => ({ name, sku, unitPrice, taxCategory, taxRate, description: `${name} (synthetic demo item)`, createdBy: accountant._id, ...extra });
  const products = await Product.insertMany([
    prod('Consulting hour', 'SRV-CONS', 1500, 'GST-18', 18),
    prod('Website maintenance', 'SRV-WEB', 4000, 'GST-18', 18),
    prod('Packaged snacks (box)', 'GD-SNACK', 600, 'GST-12', 12, { trackInventory: true, inventoryQuantity: 5000 }),
    prod('Basic stationery set', 'GD-STAT', 250, 'GST-12', 12, { trackInventory: true, inventoryQuantity: 5000 }),
    prod('Printed books', 'GD-BOOK', 400, 'GST-0', 0, { trackInventory: true, inventoryQuantity: 5000 }),
    prod('Office chair', 'GD-CHAIR', 7500, 'GST-28', 28, { trackInventory: true, inventoryQuantity: 500 }),
    prod('Packed tea', 'GD-TEA', 320, 'GST-5', 5, { trackInventory: true, inventoryQuantity: 5000 }),
  ]);

  const make = (customer, lines, daysBack, extra = {}) =>
    invoiceService.createInvoice(
      { customerId: String(customer._id), invoiceDate: daysAgo(daysBack), items: lines.map(([p, q, d = 0]) => ({ productId: String(p._id), quantity: q, discountPercent: d })), ...extra },
      accountant
    );

  // ---- normal invoices spread over ~5 months ----
  const normal = [];
  for (let i = 0; i < 46; i += 1) {
    const c = pick(customers);
    const lines = [[pick(products), 1 + Math.floor(rnd() * 6), rnd() < 0.25 ? 5 : 0]];
    if (rnd() < 0.4) lines.push([pick(products), 1 + Math.floor(rnd() * 4)]);
    normal.push(await make(c, lines, 3 + Math.floor(rnd() * 150)));
  }

  // ---- payments: most settled, some partial, some untouched ----
  for (const [idx, inv] of normal.entries()) {
    const r = idx % 5;
    if (r === 4) continue; // unpaid
    const amount = r === 3 ? Math.round(inv.grandTotal * 0.5 * 100) / 100 : inv.grandTotal;
    await recordPayment({ invoiceId: String(inv._id), kind: 'payment', amount, method: pick(['UPI', 'Bank Transfer', 'Cash', 'Card']), paymentDate: new Date(Math.max(inv.invoiceDate.getTime() + 2 * DAY, 0)), transactionReference: `DEMO-TXN-${1000 + idx}` }, accountant).catch(() => {});
  }

  // ---- injected anomalies (all synthetic) ----
  const [c1, c2, c3] = customers;
  // 1. Incorrect invoice total (grand total inflated directly in the DB, bypassing the service)
  const badTotal = await make(c1, [[products[0], 4]], 12);
  await Invoice.updateOne({ _id: badTotal._id }, { $inc: { grandTotal: 750, outstanding: 750 } });
  // 2. Tax discrepancy (tax understated consistently, as if edited by hand)
  const badTax = await make(c3, [[products[5], 6]], 20);
  const lessTax = Math.round(badTax.taxBreakdown.totalTax * 0.4 * 100) / 100;
  await Invoice.updateOne({ _id: badTax._id }, { $set: { 'items.0.taxAmount': lessTax, 'items.0.igst': lessTax, 'items.0.lineTotal': badTax.taxableAmount + lessTax, 'taxBreakdown.igst': lessTax, 'taxBreakdown.totalTax': lessTax, grandTotal: badTax.taxableAmount + lessTax, outstanding: badTax.taxableAmount + lessTax } });
  // 3. Duplicate invoice (same customer, items and total a day apart) + repeated external reference
  await make(c2, [[products[1], 3]], 9);
  await make(c2, [[products[1], 3]], 8);
  await make(c1, [[products[2], 7]], 30, { externalReference: 'LEGACY-1001' });
  await make(c1, [[products[3], 9]], 28, { externalReference: 'legacy-1001' });
  // 4. Unusual amount
  await make(c3, [[products[5], 160, 0]], 15);
  // 5. Repeated refunds on one customer within 30 days
  for (let k = 0; k < 3; k += 1) {
    const inv = await make(c2, [[products[0], 2 + k]], 24 - k * 3);
    await recordPayment({ invoiceId: String(inv._id), kind: 'payment', amount: inv.grandTotal, method: 'UPI', paymentDate: daysAgo(22 - k * 3), transactionReference: `DEMO-RFND-${k}` }, accountant);
    await recordPayment({ invoiceId: String(inv._id), kind: 'refund', amount: Math.round(inv.grandTotal * 0.6 * 100) / 100, method: 'UPI', paymentDate: daysAgo(10 - k * 2), notes: 'Synthetic refund' }, accountant);
  }

  // ---- supplied transaction records for reconciliation (synthetic bank-statement style) ----
  const invoices = await Invoice.find({ status: 'Issued' }).lean();
  const byMonth = new Map();
  invoices.forEach((i) => byMonth.set(rules.monthKey(i.invoiceDate), (byMonth.get(rules.monthKey(i.invoiceDate)) || 0) + i.grandTotal));
  const months = [...byMonth.keys()].sort();
  const records = [];
  months.forEach((m, idx) => {
    const factor = idx === 1 ? 1.35 : idx === 2 ? 0.88 : 1; // one month with higher credits (under-reporting indicator), one lower; others match
    const total = Math.round(byMonth.get(m) * factor * 100) / 100;
    const half = Math.round((total / 2) * 100) / 100;
    const date = new Date(`${m}-15T10:00:00Z`);
    records.push({ reference: `DEMO-STMT-${m}-A`, date, amount: half, direction: 'credit', source: 'synthetic-demo', description: 'Synthetic statement credit' });
    records.push({ reference: `DEMO-STMT-${m}-B`, date, amount: Math.round((total - half) * 100) / 100, direction: 'credit', source: 'synthetic-demo', description: 'Synthetic statement credit' });
  });
  await TransactionRecord.insertMany(records.map((r) => ({ ...r, importedBy: owner._id })));

  const result = await fraud.analyze({});
  const alerts = await FraudAlert.countDocuments();
  console.log(`Seeded synthetic demo data: ${customers.length} customers, ${products.length} products, ${await Invoice.countDocuments()} invoices, ${await Payment.countDocuments()} payments, ${alerts} fraud alerts.`);
  console.log('Analysis:', JSON.stringify({ created: result.created, updated: result.updated }));
  console.log('Sign in with any demo email above and the SEED_PASSWORD you provided.');
  await mongoose.connection.close();
}

main().catch(async (e) => { console.error('Seed failed:', e.message); try { await mongoose.connection.close(); } catch {} process.exit(1); });
