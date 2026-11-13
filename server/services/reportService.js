'use strict';
const env = require('../config/env');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const FraudAlert = require('../models/FraudAlert');
const TransactionRecord = require('../models/TransactionRecord');
const { dateRange } = require('../utils/helpers');
const rules = require('./fraudRules');
const { getThresholds } = require('./settingsService');
const { loadData } = require('./fraudDetectionService');

const TZ = env.REPORT_TIMEZONE;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const month = (field) => ({ $dateToString: { format: '%Y-%m', date: `$${field}`, timezone: TZ } });
const matchInvoices = (q) => ({ status: 'Issued', ...dateRange(q, 'invoiceDate') });

const DEFINITIONS = {
  totalSales: 'Net sales: taxable value after discounts, excluding GST, for issued invoices in the period.',
  totalInvoiced: 'Gross billed amount including GST for issued invoices.',
  totalTax: 'GST amounts recorded on invoices (recorded values, not independently verified tax liability).',
};

async function summary(q) {
  const match = matchInvoices(q);
  const [totalsRow] = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalSales: { $sum: '$taxableAmount' },
        totalInvoiced: { $sum: '$grandTotal' },
        totalTax: { $sum: '$taxBreakdown.totalTax' },
        outstanding: { $sum: '$outstanding' },
        collected: { $sum: '$amountPaid' },
        totalInvoices: { $sum: 1 },
        paidInvoices: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, 1, 0] } },
        unpaidInvoices: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Unpaid'] }, 1, 0] } },
        partialInvoices: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Partially Paid'] }, 1, 0] } },
      },
    },
  ]);
  const t = totalsRow || {};

  const monthlyRaw = await Invoice.aggregate([
    { $match: match },
    { $group: { _id: month('invoiceDate'), sales: { $sum: '$taxableAmount' }, tax: { $sum: '$taxBreakdown.totalTax' }, invoiced: { $sum: '$grandTotal' }, outstanding: { $sum: '$outstanding' }, invoices: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const collectedRaw = await Payment.aggregate([
    { $match: { status: 'Completed', ...dateRange(q, 'paymentDate') } },
    { $group: { _id: month('paymentDate'), collected: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
  ]);
  const collectedMap = new Map(collectedRaw.map((c) => [c._id, c.collected]));
  const monthly = monthlyRaw.map((m) => ({ month: m._id, sales: r2(m.sales), tax: r2(m.tax), invoiced: r2(m.invoiced), outstanding: r2(m.outstanding), invoices: m.invoices, collected: r2(collectedMap.get(m._id)) }));

  const statusRaw = await Invoice.aggregate([{ $match: match }, { $group: { _id: '$paymentStatus', count: { $sum: 1 }, amount: { $sum: '$grandTotal' } } }]);
  const [openAlerts, recentInvoices, recentAlerts, alertsBySeverity] = await Promise.all([
    FraudAlert.countDocuments({ reviewStatus: { $in: ['New', 'Under Review'] } }),
    Invoice.find(match).sort({ invoiceDate: -1, createdAt: -1 }).limit(6).select('invoiceNumber customerSnapshot.name grandTotal paymentStatus invoiceDate').lean(),
    FraudAlert.find().sort({ detectedAt: -1 }).limit(6).populate('invoice', 'invoiceNumber').lean(),
    FraudAlert.aggregate([{ $match: { reviewStatus: { $in: ['New', 'Under Review'] } } }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
  ]);

  return {
    cards: {
      totalSales: r2(t.totalSales), totalInvoiced: r2(t.totalInvoiced), totalTax: r2(t.totalTax), outstanding: r2(t.outstanding),
      collected: r2(t.collected), totalInvoices: t.totalInvoices || 0, paidInvoices: t.paidInvoices || 0,
      unpaidInvoices: t.unpaidInvoices || 0, partialInvoices: t.partialInvoices || 0, openAlerts,
    },
    definitions: DEFINITIONS,
    monthly,
    paymentStatus: statusRaw.map((s) => ({ status: s._id, count: s.count, amount: r2(s.amount) })),
    alertsBySeverity: alertsBySeverity.map((a) => ({ severity: a._id, count: a.count })),
    recentInvoices,
    recentAlerts,
  };
}

async function sales(q) {
  const match = matchInvoices(q);
  const [monthly, byProduct, byCustomer, byState] = await Promise.all([
    Invoice.aggregate([{ $match: match }, { $group: { _id: month('invoiceDate'), sales: { $sum: '$taxableAmount' }, invoiced: { $sum: '$grandTotal' }, invoices: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Invoice.aggregate([
      { $match: match }, { $unwind: '$items' },
      { $group: { _id: { name: '$items.name', sku: '$items.sku' }, quantity: { $sum: '$items.quantity' }, taxable: { $sum: '$items.taxableAmount' }, tax: { $sum: '$items.taxAmount' } } },
      { $sort: { taxable: -1 } }, { $limit: 15 },
    ]),
    Invoice.aggregate([{ $match: match }, { $group: { _id: { id: '$customer', name: '$customerSnapshot.name' }, taxable: { $sum: '$taxableAmount' }, invoiced: { $sum: '$grandTotal' }, outstanding: { $sum: '$outstanding' }, invoices: { $sum: 1 } } }, { $sort: { invoiced: -1 } }, { $limit: 10 }]),
    Invoice.aggregate([{ $match: match }, { $group: { _id: '$customerSnapshot.stateCode', taxable: { $sum: '$taxableAmount' }, invoices: { $sum: 1 } } }, { $sort: { taxable: -1 } }]),
  ]);
  return {
    monthly: monthly.map((m) => ({ month: m._id, sales: r2(m.sales), invoiced: r2(m.invoiced), invoices: m.invoices })),
    byProduct: byProduct.map((p) => ({ name: p._id.name, sku: p._id.sku, quantity: p.quantity, taxable: r2(p.taxable), tax: r2(p.tax) })),
    byCustomer: byCustomer.map((c) => ({ customerId: c._id.id, name: c._id.name, taxable: r2(c.taxable), invoiced: r2(c.invoiced), outstanding: r2(c.outstanding), invoices: c.invoices })),
    byRegion: byState.map((s) => ({ stateCode: s._id || 'NA', taxable: r2(s.taxable), invoices: s.invoices })),
    definitions: DEFINITIONS,
  };
}

async function tax(q) {
  const match = matchInvoices(q);
  const [byRate, monthly, totalsRow] = await Promise.all([
    Invoice.aggregate([
      { $match: match }, { $unwind: '$items' },
      { $group: { _id: { category: '$items.taxCategory', rate: '$items.taxRate' }, taxable: { $sum: '$items.taxableAmount' }, cgst: { $sum: '$items.cgst' }, sgst: { $sum: '$items.sgst' }, igst: { $sum: '$items.igst' }, tax: { $sum: '$items.taxAmount' } } },
      { $sort: { '_id.rate': 1 } },
    ]),
    Invoice.aggregate([{ $match: match }, { $group: { _id: month('invoiceDate'), taxable: { $sum: '$taxableAmount' }, cgst: { $sum: '$taxBreakdown.cgst' }, sgst: { $sum: '$taxBreakdown.sgst' }, igst: { $sum: '$taxBreakdown.igst' }, tax: { $sum: '$taxBreakdown.totalTax' } } }, { $sort: { _id: 1 } }]),
    Invoice.aggregate([{ $match: match }, { $group: { _id: null, taxable: { $sum: '$taxableAmount' }, cgst: { $sum: '$taxBreakdown.cgst' }, sgst: { $sum: '$taxBreakdown.sgst' }, igst: { $sum: '$taxBreakdown.igst' }, tax: { $sum: '$taxBreakdown.totalTax' }, invoiced: { $sum: '$grandTotal' } } }]),
  ]);

  // Invoice-level discrepancies: re-run the arithmetic and tax rules on invoices in range.
  const th = await getThresholds();
  const data = await loadData();
  const inRange = data.invoices.filter((i) => {
    if (q.from && new Date(i.invoiceDate) < new Date(q.from)) return false;
    if (q.to && new Date(i.invoiceDate) > new Date(`${q.to}T23:59:59.999Z`)) return false;
    return true;
  });
  const discrepancies = [];
  inRange.forEach((inv) => {
    const a = rules.checkIncorrectTotal(inv, th);
    const b = rules.checkTaxDiscrepancy(inv, { configFor: data.configFor }, th);
    [a, b].filter(Boolean).forEach((f) => discrepancies.push({ invoiceId: inv._id, invoiceNumber: inv.invoiceNumber, customer: inv.customerSnapshot?.name, category: f.category, description: f.description }));
  });
  const reconciliation = rules.reconcileMonthly(inRange, await TransactionRecord.find(dateRange(q, 'date')).lean(), th);
  const t = totalsRow[0] || {};
  return {
    totals: { taxable: r2(t.taxable), cgst: r2(t.cgst), sgst: r2(t.sgst), igst: r2(t.igst), totalTax: r2(t.tax), invoiced: r2(t.invoiced) },
    byRate: byRate.map((r) => ({ category: r._id.category, rate: r._id.rate, taxable: r2(r.taxable), cgst: r2(r.cgst), sgst: r2(r.sgst), igst: r2(r.igst), tax: r2(r.tax) })),
    monthly: monthly.map((m) => ({ month: m._id, taxable: r2(m.taxable), cgst: r2(m.cgst), sgst: r2(m.sgst), igst: r2(m.igst), tax: r2(m.tax) })),
    discrepancies: discrepancies.slice(0, 200),
    reconciliation,
    notice: 'Figures are the tax values RECORDED on invoices in this system. They are not independently verified tax liability and do not replace professional advice or returns filed with the tax authority.',
  };
}

async function fraud(q) {
  const match = dateRange(q, 'detectedAt');
  const [byCategory, bySeverity, byStatus, trend, resolution, avg] = await Promise.all([
    FraudAlert.aggregate([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 }, avgScore: { $avg: '$riskScore' } } }, { $sort: { count: -1 } }]),
    FraudAlert.aggregate([{ $match: match }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
    FraudAlert.aggregate([{ $match: match }, { $group: { _id: '$reviewStatus', count: { $sum: 1 } } }]),
    FraudAlert.aggregate([{ $match: match }, { $group: { _id: month('detectedAt'), detected: { $sum: 1 }, high: { $sum: { $cond: [{ $eq: ['$severity', 'High'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
    FraudAlert.aggregate([{ $match: { ...match, reviewStatus: { $in: ['Resolved', 'False Positive'] } } }, { $group: { _id: month('updatedAt'), resolved: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'Resolved'] }, 1, 0] } }, falsePositive: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'False Positive'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
    FraudAlert.aggregate([{ $match: match }, { $group: { _id: null, avg: { $avg: '$riskScore' }, total: { $sum: 1 } } }]),
  ]);
  return {
    total: avg[0]?.total || 0,
    averageRiskScore: r2(avg[0]?.avg),
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.count, avgScore: r2(c.avgScore) })),
    bySeverity: bySeverity.map((s) => ({ severity: s._id, count: s.count })),
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
    trend: trend.map((t) => ({ month: t._id, detected: t.detected, high: t.high })),
    resolutionTrend: resolution.map((t) => ({ month: t._id, resolved: t.resolved, falsePositive: t.falsePositive })),
    notice: 'Risk scores are explainable indicators for human review, not probabilities of fraud.',
  };
}

// ---- CSV ----
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','));
  return [head, ...body].join('\n');
}

module.exports = { summary, sales, tax, fraud, toCsv };
