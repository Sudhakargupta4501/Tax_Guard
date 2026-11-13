'use strict';
const Invoice = require('../models/Invoice');
const FraudAlert = require('../models/FraudAlert');
const Payment = require('../models/Payment');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok, paginate, pageMeta, escapeRegex, dateRange } = require('../utils/helpers');
const { logAudit } = require('../utils/audit');
const invoiceService = require('../services/invoiceService');
const { analyzeInvoiceSafe } = require('../services/fraudDetectionService');
const { getBusinessProfile } = require('../services/settingsService');
const { renderInvoicePdf } = require('../services/pdfService');
const { PERMISSIONS } = require('../middleware/auth');

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const q = req.query;
  const filter = { ...dateRange(q, 'invoiceDate') };
  if (q.customer) filter.customer = q.customer;
  if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
  if (q.status) filter.status = q.status;
  if (q.overdue === 'true') Object.assign(filter, { status: 'Issued', outstanding: { $gt: 0 }, dueDate: { $lt: new Date() } });
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ invoiceNumber: rx }, { 'customerSnapshot.name': rx }];
  }
  const [rows, total] = await Promise.all([
    Invoice.find(filter).sort({ invoiceDate: -1, createdAt: -1 }).skip(skip).limit(limit)
      .select('-items').lean({ virtuals: true }),
    Invoice.countDocuments(filter),
  ]);
  const counts = await FraudAlert.aggregate([
    { $match: { invoice: { $in: rows.map((r) => r._id) }, reviewStatus: { $in: ['New', 'Under Review'] } } },
    { $group: { _id: '$invoice', count: { $sum: 1 }, maxScore: { $max: '$riskScore' } } },
  ]);
  const byInvoice = new Map(counts.map((c) => [String(c._id), c]));
  const data = rows.map((r) => ({ ...r, openAlerts: byInvoice.get(String(r._id))?.count || 0, maxRiskScore: byInvoice.get(String(r._id))?.maxScore || 0 }));
  ok(res, data, { pagination: pageMeta(page, limit, total) });
});

exports.create = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.createInvoice(req.body, req.user);
  await logAudit(req, { action: 'invoice.create', entityType: 'Invoice', entityId: invoice._id, summary: { invoiceNumber: invoice.invoiceNumber, grandTotal: invoice.grandTotal, supplyType: invoice.supplyType } });
  await analyzeInvoiceSafe(invoice._id);
  ok(res, invoice, { message: `Invoice ${invoice.invoiceNumber} created` }, 201);
});

exports.get = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).lean({ virtuals: true });
  if (!invoice) throw ApiError.notFound('Invoice not found');
  const [alerts, payments] = await Promise.all([
    FraudAlert.find({ invoice: invoice._id }).sort({ riskScore: -1 }).select('alertId category description riskScore severity reviewStatus detectedAt').lean(),
    Payment.find({ invoice: invoice._id }).sort({ paymentDate: -1 }).populate('recordedBy', 'name').lean(),
  ]);
  ok(res, { invoice, alerts, payments });
});

exports.update = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  const canCancel = PERMISSIONS['invoice:cancel'].includes(req.user.role);
  const { changes } = await invoiceService.updateInvoice(invoice, req.body, req.user, { canCancel });
  if (!Object.keys(changes).length) throw ApiError.badRequest('No changes supplied');
  await logAudit(req, { action: req.body.status === 'Cancelled' ? 'invoice.cancel' : 'invoice.update', entityType: 'Invoice', entityId: invoice._id, summary: { invoiceNumber: invoice.invoiceNumber, ...changes, reason: req.body.cancelReason } });
  await analyzeInvoiceSafe(invoice._id); // recalculates related alert scores
  ok(res, invoice, { message: 'Invoice updated' });
});

exports.pdf = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).lean();
  if (!invoice) throw ApiError.notFound('Invoice not found');
  const business = await getBusinessProfile();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  const doc = renderInvoicePdf(invoice, business, res);
  doc.on('error', (err) => {
    console.error('PDF generation failed:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not generate the PDF' });
    else res.destroy(err);
  });
  await logAudit(req, { action: 'invoice.pdf', entityType: 'Invoice', entityId: invoice._id, summary: { invoiceNumber: invoice.invoiceNumber } });
});
