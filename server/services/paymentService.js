'use strict';
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const ApiError = require('../utils/ApiError');
const { toPaise, fromPaise } = require('../utils/money');
const { derivePaymentStatus } = require('./invoiceService');

const DAY = 24 * 60 * 60 * 1000;

/** Net amount received for an invoice in paise: completed payments minus completed refunds. */
async function netPaidPaise(invoiceId) {
  const rows = await Payment.find({ invoice: invoiceId, status: 'Completed' }).select('amount kind').lean();
  return rows.reduce((sum, p) => sum + (p.kind === 'refund' ? -1 : 1) * toPaise(p.amount), 0);
}

async function syncInvoice(invoice) {
  const net = await netPaidPaise(invoice._id);
  invoice.amountPaid = fromPaise(net);
  invoice.outstanding = invoice.status === 'Cancelled' ? 0 : fromPaise(toPaise(invoice.grandTotal) - net);
  invoice.paymentStatus = derivePaymentStatus(invoice.grandTotal, invoice.amountPaid);
  await invoice.save();
  return invoice;
}

async function recordPayment(payload, user) {
  const invoice = await Invoice.findById(payload.invoiceId);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status === 'Cancelled') throw ApiError.conflict('Cannot record payments against a cancelled invoice');

  const amountPaise = toPaise(payload.amount);
  if (amountPaise <= 0) throw ApiError.badRequest('Amount must be greater than zero');
  const net = await netPaidPaise(invoice._id);
  const outstandingPaise = toPaise(invoice.grandTotal) - net;

  if (payload.kind === 'payment' && amountPaise > outstandingPaise) {
    throw ApiError.conflict(`Payment exceeds the outstanding balance of ${fromPaise(outstandingPaise).toFixed(2)}`);
  }
  if (payload.kind === 'refund' && amountPaise > net) {
    throw ApiError.conflict(`Refund exceeds the amount paid (${fromPaise(net).toFixed(2)})`);
  }

  const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
  if (paymentDate.getTime() > Date.now() + DAY) throw ApiError.badRequest('Payment date cannot be in the future');

  // Guard against accidental double submission (double click / retry).
  const recent = await Payment.findOne({
    invoice: invoice._id,
    kind: payload.kind,
    amount: payload.amount,
    method: payload.method,
    createdAt: { $gte: new Date(Date.now() - 30 * 1000) },
  });
  if (recent) throw ApiError.conflict('A identical payment was just recorded. Possible duplicate submission.');

  let payment;
  try {
    payment = await Payment.create({
      invoice: invoice._id,
      kind: payload.kind,
      amount: payload.amount,
      method: payload.method,
      transactionReference: payload.transactionReference,
      paymentDate,
      notes: payload.notes,
      idempotencyKey: payload.idempotencyKey,
      verified: false,
      status: 'Completed',
      recordedBy: user._id,
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.idempotencyKey) throw ApiError.conflict('This payment request was already processed');
    throw err;
  }

  // Re-check after insert in case of a concurrent request (no multi-document transaction needed on a single node).
  const after = await netPaidPaise(invoice._id);
  if (after > toPaise(invoice.grandTotal) || after < 0) {
    payment.status = 'Rejected';
    await payment.save();
    await syncInvoice(invoice);
    throw ApiError.conflict('Payment rejected because it would exceed the invoice total');
  }
  await syncInvoice(invoice);
  return { payment, invoice };
}

module.exports = { recordPayment, syncInvoice, netPaidPaise };
