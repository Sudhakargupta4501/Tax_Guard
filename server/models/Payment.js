'use strict';
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    kind: { type: String, enum: ['payment', 'refund'], default: 'payment' },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['Cash', 'Bank Transfer', 'UPI', 'Card', 'Cheque', 'Other'], required: true },
    transactionReference: { type: String, trim: true, maxlength: 80 },
    paymentDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ['Completed', 'Rejected'], default: 'Completed' },
    // Entries are typed in by staff; they are NOT verified against a bank.
    verified: { type: Boolean, default: false },
    notes: { type: String, maxlength: 300 },
    idempotencyKey: { type: String, trim: true, maxlength: 80 },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

paymentSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
paymentSchema.index({ transactionReference: 1 }, { sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
