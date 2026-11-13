'use strict';
const FraudAlert = require('../models/FraudAlert');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const TransactionRecord = require('../models/TransactionRecord');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok, paginate, pageMeta, escapeRegex, dateRange } = require('../utils/helpers');
const { logAudit } = require('../utils/audit');
const fraud = require('../services/fraudDetectionService');
const ml = require('../services/mlClient');
const { getThresholds } = require('../services/settingsService');
const { CATEGORY_LABELS, RULE_WEIGHTS } = require('../config/fraudConfig');

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const q = req.query;
  const filter = { ...dateRange(q, 'detectedAt') };
  ['category', 'severity', 'reviewStatus', 'invoice'].forEach((k) => { if (q[k]) filter[k] = q[k]; });
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const invoices = await Invoice.find({ $or: [{ invoiceNumber: rx }, { 'customerSnapshot.name': rx }] }).select('_id').limit(200).lean();
    filter.$or = [{ alertId: rx }, { description: rx }, { invoice: { $in: invoices.map((i) => i._id) } }];
  }
  const [rows, total] = await Promise.all([
    FraudAlert.find(filter).sort({ detectedAt: -1, riskScore: -1 }).skip(skip).limit(limit)
      .select('-history -reviewComments -triggeredRules')
      .populate('invoice', 'invoiceNumber grandTotal customerSnapshot.name').populate('assignedReviewer', 'name').lean(),
    FraudAlert.countDocuments(filter),
  ]);
  ok(res, rows, { pagination: pageMeta(page, limit, total) });
});

exports.meta = asyncHandler(async (_req, res) => {
  const [thresholds, mlStatus, txCount] = await Promise.all([getThresholds(), ml.health(), TransactionRecord.countDocuments()]);
  ok(res, { detectionVersion: fraud.DETECTION_VERSION, categories: CATEGORY_LABELS, weights: RULE_WEIGHTS, thresholds, ml: mlStatus, suppliedTransactionRecords: txCount });
});

exports.get = asyncHandler(async (req, res) => {
  const alert = await FraudAlert.findById(req.params.id).populate('assignedReviewer', 'name email').populate('customer', 'name email gstin').lean();
  if (!alert) throw ApiError.notFound('Alert not found');
  const [invoice, payment] = await Promise.all([
    alert.invoice ? Invoice.findById(alert.invoice).lean() : null,
    alert.transactionRef ? Payment.findById(alert.transactionRef).lean() : null,
  ]);
  ok(res, { alert, invoice, payment, categoryLabel: CATEGORY_LABELS[alert.category] });
});

exports.analyze = asyncHandler(async (req, res) => {
  const result = await fraud.analyze(req.body);
  await logAudit(req, { action: 'fraud.analyze', entityType: 'FraudAlert', summary: { ...result, scope: { invoiceId: req.body.invoiceId, from: req.body.from, to: req.body.to } } });
  ok(res, result, { message: `Analysis complete: ${result.created} new, ${result.updated} updated, ${result.autoResolved} auto-resolved` });
});

exports.review = asyncHandler(async (req, res) => {
  const alert = await FraudAlert.findById(req.params.id);
  if (!alert) throw ApiError.notFound('Alert not found');
  const from = alert.reviewStatus;
  await fraud.reviewAlert(alert, req.body, req.user);
  await logAudit(req, { action: 'fraud.review', entityType: 'FraudAlert', entityId: alert._id, summary: { alertId: alert.alertId, from, to: alert.reviewStatus, commented: Boolean(req.body.comment) } });
  ok(res, alert, { message: 'Alert updated' });
});

exports.importTransactions = asyncHandler(async (req, res) => {
  const docs = req.body.records.map((r) => ({ ...r, source: req.body.source || 'manual-import', importedBy: req.user._id }));
  const created = await TransactionRecord.insertMany(docs);
  await logAudit(req, { action: 'transactions.import', entityType: 'TransactionRecord', summary: { count: created.length, source: req.body.source } });
  ok(res, { imported: created.length }, { message: `${created.length} transaction record(s) imported` }, 201);
});

exports.listTransactions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const [rows, total] = await Promise.all([TransactionRecord.find().sort({ date: -1 }).skip(skip).limit(limit).lean(), TransactionRecord.countDocuments()]);
  ok(res, rows, { pagination: pageMeta(page, limit, total) });
});
