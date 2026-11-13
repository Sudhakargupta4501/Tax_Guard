'use strict';
const Payment = require('../models/Payment');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok, paginate, pageMeta, dateRange } = require('../utils/helpers');
const { logAudit } = require('../utils/audit');
const { recordPayment } = require('../services/paymentService');
const { analyzeInvoiceSafe } = require('../services/fraudDetectionService');

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { ...dateRange(req.query, 'paymentDate') };
  if (req.query.invoice) filter.invoice = req.query.invoice;
  if (req.query.kind) filter.kind = req.query.kind;
  const [rows, total] = await Promise.all([
    Payment.find(filter).sort({ paymentDate: -1, createdAt: -1 }).skip(skip).limit(limit)
      .populate('invoice', 'invoiceNumber grandTotal customerSnapshot.name paymentStatus').populate('recordedBy', 'name').lean(),
    Payment.countDocuments(filter),
  ]);
  ok(res, rows, { pagination: pageMeta(page, limit, total) });
});

exports.create = asyncHandler(async (req, res) => {
  const { payment, invoice } = await recordPayment(req.body, req.user);
  await logAudit(req, {
    action: payment.kind === 'refund' ? 'payment.refund' : 'payment.record',
    entityType: 'Payment', entityId: payment._id,
    summary: { invoiceNumber: invoice.invoiceNumber, amount: payment.amount, method: payment.method, kind: payment.kind, resultingStatus: invoice.paymentStatus },
  });
  await analyzeInvoiceSafe(invoice._id);
  ok(res, { payment, invoice }, { message: payment.kind === 'refund' ? 'Refund recorded (manual entry, not bank-verified)' : 'Payment recorded (manual entry, not bank-verified)' }, 201);
});

exports.get = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate('invoice', 'invoiceNumber grandTotal outstanding paymentStatus customerSnapshot.name').populate('recordedBy', 'name').lean();
  if (!payment) throw ApiError.notFound('Payment not found');
  ok(res, payment);
});
