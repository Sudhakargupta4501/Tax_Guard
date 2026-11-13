'use strict';
/**
 * Fraud-risk detection orchestrator.
 *   Stage 1: explainable rules (fraudRules.js) -> alerts for HUMAN REVIEW (never a verdict of fraud).
 *   Stage 2: optional ML anomaly indicator (Python Isolation Forest) when the service is reachable.
 */
const crypto = require('crypto');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const FraudAlert = require('../models/FraudAlert');
const TaxConfiguration = require('../models/TaxConfiguration');
const TransactionRecord = require('../models/TransactionRecord');
const { nextSequence } = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { DETECTION_VERSION, CATEGORY_LABELS } = require('../config/fraudConfig');
const { getThresholds } = require('./settingsService');
const rules = require('./fraudRules');
const ml = require('./mlClient');

const OPEN = ['New', 'Under Review'];
const hash = (obj) => crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');

async function loadData() {
  const [invoices, payments, configs, txRecords] = await Promise.all([
    Invoice.find({ status: 'Issued' }).limit(50000).lean(),
    Payment.find({ status: 'Completed' }).limit(100000).lean(),
    TaxConfiguration.find({ isActive: true }).sort({ effectiveDate: -1 }).lean(),
    TransactionRecord.find().limit(100000).lean(),
  ]);
  const configFor = (category, date) => configs.find((c) => c.category === category && new Date(c.effectiveDate) <= new Date(date)) || null;
  return { invoices, payments, configs, txRecords, configFor };
}

/** Runs every rule and returns normalised findings (before persistence). */
function collectFindings(data, th, scope) {
  const { invoices, payments, txRecords, configFor } = data;
  const invoiceById = new Map(invoices.map((i) => [String(i._id), i]));
  const stats = rules.medianMad(invoices.map((i) => Number(i.grandTotal)));
  const dupes = rules.findDuplicates(invoices, th);
  const bursts = rules.findFrequencyBursts(invoices, th);
  const findings = [];

  const inScope = (inv) => {
    if (scope.invoiceId) return String(inv._id) === String(scope.invoiceId);
    if (scope.from && new Date(inv.invoiceDate) < new Date(scope.from)) return false;
    if (scope.to && new Date(inv.invoiceDate) > new Date(scope.to)) return false;
    return true;
  };

  invoices.filter(inScope).forEach((inv) => {
    const perInvoice = [
      rules.checkIncorrectTotal(inv, th),
      rules.checkTaxDiscrepancy(inv, { configFor }, th),
      rules.checkMissingInfo(inv, th),
      rules.checkUnusualAmount(inv, stats, th),
      dupes.get(String(inv._id)) || null,
      bursts.get(String(inv._id)) || null,
    ].filter(Boolean);
    perInvoice.forEach((f) =>
      findings.push({ ...f, entityType: 'invoice', entityId: String(inv._id), invoice: inv._id, customer: inv.customer, group: String(inv._id) })
    );
  });

  if (!scope.invoiceId) {
    // Repeated refunds
    const refunds = payments.filter((p) => p.kind === 'refund');
    rules.findRepeatedRefunds(refunds, invoiceById, th).forEach(({ payment, invoice, finding }) => {
      if (!inScope(invoice)) return;
      findings.push({ ...finding, entityType: 'payment', entityId: String(payment._id), invoice: invoice._id, customer: invoice.customer, transactionRef: payment._id, group: String(invoice._id) });
    });

    if (txRecords.length) {
      // Monthly reconciliation of recorded invoices against supplied transaction records
      rules.reconcileMonthly(invoices, txRecords, th).filter((r) => r.flag).forEach((row) => {
        findings.push({ ...rules.reconciliationFinding(row, th), entityType: 'reconciliation', entityId: row.month, group: `recon:${row.month}` });
      });
      // Payment-level reference mismatches
      const byRef = new Map(txRecords.filter((t) => t.reference).map((t) => [t.reference, t]));
      payments.filter((p) => p.kind === 'payment' && p.transactionReference).forEach((p) => {
        const inv = invoiceById.get(String(p.invoice));
        if (!inv || !inScope(inv)) return;
        const f = rules.paymentReferenceMismatch(p, byRef.get(p.transactionReference), inv);
        if (f) findings.push({ ...f, entityType: 'payment', entityId: String(p._id), invoice: inv._id, customer: inv.customer, transactionRef: p._id, group: String(inv._id) });
      });
    }
  }
  return findings;
}

function finalise(findings, th) {
  const cats = new Map();
  findings.forEach((f) => {
    if (!cats.has(f.group)) cats.set(f.group, new Set());
    cats.get(f.group).add(f.category);
  });
  return findings.map((f) => {
    const set = cats.get(f.group);
    const s = rules.scoreFinding(f, set.size, th);
    return {
      ...f,
      riskScore: s.riskScore,
      severity: s.severity,
      corroboratingCategories: [...set].filter((c) => c !== f.category),
      detectionMethod: 'rule-based',
      detectionVersion: DETECTION_VERSION,
      dedupeKey: `${f.category}:${f.entityType}:${f.entityId}`,
      evidenceHash: hash({ r: f.rules.map((r) => r.evidence), d: f.description }),
    };
  });
}

async function persist(findings, existingOpenByKey, closedByKey, counters) {
  for (const f of findings) {
    const open = existingOpenByKey.get(f.dedupeKey);
    if (open) {
      // Recalculate in place; never override a reviewer's status.
      open.description = f.description;
      open.triggeredRules = f.rules;
      open.riskScore = f.riskScore;
      open.severity = f.severity;
      open.corroboratingCategories = f.corroboratingCategories;
      open.detectionVersion = f.detectionVersion;
      open.evidenceHash = f.evidenceHash;
      open.lastDetectedAt = new Date();
      await open.save();
      counters.updated += 1;
      continue;
    }
    if ((closedByKey.get(f.dedupeKey) || []).some((a) => a.evidenceHash === f.evidenceHash)) continue; // already reviewed with identical evidence
    const seq = await nextSequence('fraud-alert');
    await FraudAlert.create({
      alertId: `FA-${String(seq).padStart(6, '0')}`,
      invoice: f.invoice,
      transactionRef: f.transactionRef,
      customer: f.customer,
      entityType: f.entityType,
      entityId: f.entityId,
      category: f.category,
      description: f.description,
      triggeredRules: f.rules,
      corroboratingCategories: f.corroboratingCategories,
      detectionMethod: f.detectionMethod,
      detectionVersion: f.detectionVersion,
      riskScore: f.riskScore,
      severity: f.severity,
      dedupeKey: f.dedupeKey,
      evidenceHash: f.evidenceHash,
      history: [{ at: new Date(), userName: 'System', from: null, to: 'New', note: `Alert generated by ${f.detectionMethod} ${f.detectionVersion}` }],
    });
    counters.created += 1;
  }
}

async function mlFindings(data, th, scope) {
  const { invoices, payments } = data;
  if (invoices.length < th.mlMinInvoices) return { available: false, reason: `At least ${th.mlMinInvoices} invoices are needed for the ML indicator (found ${invoices.length})`, findings: [] };
  const refundsByCustomer = new Map();
  const invById = new Map(invoices.map((i) => [String(i._id), i]));
  payments.filter((p) => p.kind === 'refund').forEach((p) => {
    const inv = invById.get(String(p.invoice));
    if (inv) refundsByCustomer.set(String(inv.customer), (refundsByCustomer.get(String(inv.customer)) || 0) + 1);
  });
  const byCustomer = new Map();
  invoices.forEach((i) => {
    const k = String(i.customer);
    if (!byCustomer.has(k)) byCustomer.set(k, []);
    byCustomer.get(k).push(i);
  });
  const rows = invoices.map((i) => {
    const hist = byCustomer.get(String(i.customer)).filter((x) => String(x._id) !== String(i._id)).map((x) => Number(x.grandTotal));
    const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : Number(i.grandTotal);
    const sd = hist.length > 2 ? Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length) : 0;
    const last30 = byCustomer.get(String(i.customer)).filter((x) => Math.abs(new Date(i.invoiceDate) - new Date(x.invoiceDate)) <= 30 * 86400000).length;
    return {
      id: String(i._id),
      amount: Number(i.grandTotal),
      tax_amount: Number(i.taxBreakdown?.totalTax || 0),
      item_count: (i.items || []).length,
      customer_invoices_30d: last30,
      customer_refund_count: refundsByCustomer.get(String(i.customer)) || 0,
      deviation_from_customer_mean: sd > 0 ? (Number(i.grandTotal) - mean) / sd : 0,
    };
  });
  const out = await ml.scoreInvoices(rows);
  if (!out.available) return { available: false, reason: out.reason, findings: [] };

  const findings = [];
  (out.results || []).filter((r) => r.is_outlier).forEach((r) => {
    const inv = invById.get(r.id);
    if (!inv) return;
    if (scope.invoiceId && String(inv._id) !== String(scope.invoiceId)) return;
    if (scope.from && new Date(inv.invoiceDate) < new Date(scope.from)) return;
    if (scope.to && new Date(inv.invoiceDate) > new Date(scope.to)) return;
    const score = Math.round(Math.min(100, r.risk_indicator * th.mlScoreScale));
    findings.push({
      category: 'ML_ANOMALY', entityType: 'invoice', entityId: String(inv._id), invoice: inv._id, customer: inv.customer, group: `ml:${inv._id}`,
      description: `An Isolation Forest model trained on ${rows.length} invoices from this database ranked ${inv.invoiceNumber} among the most statistically unusual (relative indicator ${r.risk_indicator.toFixed(0)}/100 within this batch). This is an unsupervised indicator for investigation only; it has not been validated against labelled fraud cases.`,
      rules: [{ ruleId: 'ISOLATION_FOREST', name: 'Isolation Forest anomaly indicator', weight: score, detail: 'Unsupervised outlier, not a probability', evidence: { features: rows.find((x) => x.id === r.id), anomalyScore: r.anomaly_score, model: out.model } }],
      riskScore: score, severity: rules.severityFor(score, th), corroboratingCategories: [],
      detectionMethod: 'ml-isolation-forest', detectionVersion: out.model?.version || 'isolation-forest',
      dedupeKey: `ML_ANOMALY:invoice:${inv._id}`, evidenceHash: hash({ id: r.id, s: Math.round(r.risk_indicator / 10) }),
    });
  });
  return { available: true, findings, model: out.model };
}

async function analyze({ invoiceId, from, to, includeMl = false } = {}) {
  const th = await getThresholds();
  const scope = { invoiceId, from, to };
  const data = await loadData();
  if (invoiceId && !data.invoices.some((i) => String(i._id) === String(invoiceId))) {
    // Invoice cancelled or missing: close its open rule-based alerts.
    const stale = await FraudAlert.find({ invoice: invoiceId, detectionMethod: 'rule-based', reviewStatus: 'New' });
    for (const a of stale) await autoResolve(a, 'Invoice is no longer active (cancelled).');
    return { analyzedInvoices: 0, created: 0, updated: 0, autoResolved: stale.length, ml: { requested: includeMl, available: false } };
  }

  const findings = finalise(collectFindings(data, th, scope), th);
  const scopeInvoices = data.invoices.filter((i) => {
    if (invoiceId) return String(i._id) === String(invoiceId);
    if (from && new Date(i.invoiceDate) < new Date(from)) return false;
    if (to && new Date(i.invoiceDate) > new Date(to)) return false;
    return true;
  });

  const keys = findings.map((f) => f.dedupeKey);
  const mlResult = includeMl ? await mlFindings(data, th, scope) : { available: false, findings: [] };
  mlResult.findings.forEach((f) => keys.push(f.dedupeKey));
  const existing = await FraudAlert.find({ dedupeKey: { $in: keys } });
  const openByKey = new Map();
  const closedByKey = new Map();
  existing.forEach((a) => {
    if (OPEN.includes(a.reviewStatus)) openByKey.set(a.dedupeKey, a);
    else closedByKey.set(a.dedupeKey, [...(closedByKey.get(a.dedupeKey) || []), a]);
  });

  const counters = { created: 0, updated: 0, autoResolved: 0 };
  await persist([...findings, ...mlResult.findings], openByKey, closedByKey, counters);

  // Alerts whose condition no longer holds (records were corrected) are closed by the system, with history kept.
  const currentKeys = new Set(findings.map((f) => f.dedupeKey));
  const scopeIds = scopeInvoices.map((i) => i._id);
  const staleQuery = { detectionMethod: 'rule-based', reviewStatus: 'New' };
  const stale = await FraudAlert.find(
    invoiceId
      ? { ...staleQuery, invoice: invoiceId, entityType: 'invoice' }
      : { ...staleQuery, $or: [{ invoice: { $in: scopeIds } }, ...(from || to ? [] : [{ entityType: 'reconciliation' }])] }
  );
  for (const a of stale) {
    if (!currentKeys.has(a.dedupeKey)) {
      await autoResolve(a, 'Condition no longer detected after records changed.');
      counters.autoResolved += 1;
    }
  }

  return {
    analyzedInvoices: scopeInvoices.length,
    ...counters,
    detectionVersion: DETECTION_VERSION,
    ml: { requested: includeMl, available: mlResult.available, reason: mlResult.reason, model: mlResult.model },
  };
}

async function autoResolve(alert, note) {
  alert.history.push({ at: new Date(), userName: 'System', from: alert.reviewStatus, to: 'Resolved', note });
  alert.reviewStatus = 'Resolved';
  alert.resolutionNotes = `Auto-resolved by detection engine: ${note}`;
  await alert.save();
}

/** Best-effort re-analysis used after invoices/payments change; never blocks the main request. */
async function analyzeInvoiceSafe(invoiceId) {
  try {
    return await analyze({ invoiceId });
  } catch (err) {
    console.error('Fraud analysis failed:', err.message);
    return null;
  }
}

const TRANSITIONS = {
  New: ['Under Review', 'Resolved', 'False Positive'],
  'Under Review': ['New', 'Resolved', 'False Positive'],
  Resolved: ['Under Review'],
  'False Positive': ['Under Review'],
};

async function reviewAlert(alert, body, user) {
  const { reviewStatus, comment, resolutionNotes, assignedReviewer } = body;
  if (!reviewStatus && !comment && !resolutionNotes && !assignedReviewer) throw ApiError.badRequest('Nothing to update');

  if (reviewStatus && reviewStatus !== alert.reviewStatus) {
    if (!TRANSITIONS[alert.reviewStatus].includes(reviewStatus)) {
      throw ApiError.conflict(`Cannot move an alert from "${alert.reviewStatus}" to "${reviewStatus}"`);
    }
    if (['Resolved', 'False Positive'].includes(reviewStatus) && !(resolutionNotes || comment)) {
      throw ApiError.badRequest('Please document the reason for this decision (resolution notes or a comment).');
    }
    if (alert.reviewStatus !== 'New' && reviewStatus === 'Under Review' && !(comment || resolutionNotes)) {
      throw ApiError.badRequest('Please add a comment explaining why this alert is being reopened.');
    }
    alert.history.push({ at: new Date(), user: user._id, userName: user.name, from: alert.reviewStatus, to: reviewStatus, note: resolutionNotes || comment });
    alert.reviewStatus = reviewStatus;
    if (!alert.assignedReviewer) alert.assignedReviewer = user._id;
  }
  if (assignedReviewer) alert.assignedReviewer = assignedReviewer;
  if (comment) alert.reviewComments.push({ user: user._id, userName: user.name, comment, at: new Date() });
  if (resolutionNotes) alert.resolutionNotes = resolutionNotes;
  await alert.save();
  return alert;
}

module.exports = { analyze, analyzeInvoiceSafe, reviewAlert, collectFindings, finalise, loadData, DETECTION_VERSION, CATEGORY_LABELS };
