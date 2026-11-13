'use strict';
const mongoose = require('mongoose');

const CATEGORIES = [
  'DUPLICATE_INVOICE', 'INCORRECT_TOTAL', 'TAX_DISCREPANCY', 'MISSING_INFO', 'UNUSUAL_AMOUNT',
  'REPEATED_REFUND', 'SUSPICIOUS_FREQUENCY', 'SALES_RECONCILIATION', 'POTENTIAL_UNDER_REPORTING', 'ML_ANOMALY',
];
const STATUSES = ['New', 'Under Review', 'Resolved', 'False Positive'];

const ruleSchema = new mongoose.Schema(
  { ruleId: String, name: String, weight: Number, detail: String, evidence: mongoose.Schema.Types.Mixed },
  { _id: false }
);

const fraudAlertSchema = new mongoose.Schema(
  {
    alertId: { type: String, unique: true, required: true }, // FA-000001
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', index: true },
    transactionRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    entityType: { type: String, enum: ['invoice', 'payment', 'reconciliation'], required: true },
    entityId: { type: String, required: true }, // invoice/payment id, or YYYY-MM for reconciliation
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    description: { type: String, required: true },
    triggeredRules: [ruleSchema],
    corroboratingCategories: [String],
    detectionMethod: { type: String, enum: ['rule-based', 'ml-isolation-forest'], default: 'rule-based' },
    detectionVersion: { type: String, required: true },
    riskScore: { type: Number, min: 0, max: 100, required: true },
    severity: { type: String, enum: ['Low', 'Medium', 'High'], required: true, index: true },
    reviewStatus: { type: String, enum: STATUSES, default: 'New', index: true },
    assignedReviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewComments: [
      { user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, userName: String, comment: String, at: { type: Date, default: Date.now }, _id: false },
    ],
    resolutionNotes: { type: String, maxlength: 1000 },
    history: [
      { at: { type: Date, default: Date.now }, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, userName: String, from: String, to: String, note: String, _id: false },
    ],
    dedupeKey: { type: String, required: true, index: true },
    evidenceHash: { type: String, required: true },
    detectedAt: { type: Date, default: Date.now, index: true },
    lastDetectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

fraudAlertSchema.set('toJSON', { transform: (_d, r) => { delete r.__v; return r; } });

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
