'use strict';
const mongoose = require('mongoose');

/**
 * Externally supplied transaction records (e.g. a bank/gateway statement export)
 * used to reconcile against recorded invoices. Imported by staff; not auto-verified.
 */
const transactionRecordSchema = new mongoose.Schema(
  {
    reference: { type: String, trim: true, maxlength: 80, index: true },
    date: { type: Date, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: ['credit', 'debit'], default: 'credit' },
    source: { type: String, default: 'manual-import', maxlength: 60 },
    description: { type: String, maxlength: 200 },
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TransactionRecord', transactionRecordSchema);
