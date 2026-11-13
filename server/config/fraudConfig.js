'use strict';
/**
 * Fraud-detection thresholds and rule weights.
 * All values are ILLUSTRATIVE defaults and must be tuned on representative data.
 * Admins can override them at runtime through Settings (stored in the Setting collection).
 */
const DETECTION_VERSION = 'rules-v1.0.0';

const DEFAULT_THRESHOLDS = {
  // arithmetic tolerance in rupees (absolute) when comparing recomputed vs stored totals
  amountToleranceRupees: 0.05,
  // duplicate detection: invoices with identical customer + total + items within N days
  duplicateWindowDays: 7,
  // unusual amount: modified z-score (median/MAD) cut-off and minimum history size
  unusualAmountZScore: 3.5,
  unusualAmountMinHistory: 10,
  // frequency: invoices to the same customer on the same calendar day
  invoicesPerCustomerPerDay: 5,
  // refunds: this many refunds for one customer inside the window
  refundCountThreshold: 3,
  refundWindowDays: 30,
  // missing info: B2B invoices above this value should carry a customer GSTIN
  gstinRequiredAboveRupees: 50000,
  // reconciliation: relative difference between recorded and supplied monthly sales
  reconciliationTolerancePct: 5,
  underReportingThresholdPct: 10,
  // ML extension
  mlMinInvoices: 30,
  mlScoreScale: 0.7,
  // severity cut-offs on the 0-100 risk score
  mediumSeverityFrom: 35,
  highSeverityFrom: 65,
  // corroboration: extra points per additional distinct category on the same invoice
  corroborationBonus: 10,
  corroborationBonusCap: 20,
};

// Base weight (0-100) of each rule before magnitude and corroboration adjustments.
const RULE_WEIGHTS = {
  DUPLICATE_INVOICE: 70,
  INCORRECT_TOTAL: 55,
  TAX_DISCREPANCY: 55,
  MISSING_INFO: 30,
  UNUSUAL_AMOUNT: 25,
  REPEATED_REFUND: 50,
  SUSPICIOUS_FREQUENCY: 35,
  SALES_RECONCILIATION: 45,
  POTENTIAL_UNDER_REPORTING: 60,
  ML_ANOMALY: 0, // ML score is used directly
};

const CATEGORY_LABELS = {
  DUPLICATE_INVOICE: 'Duplicate Invoice',
  INCORRECT_TOTAL: 'Incorrect Invoice Total',
  TAX_DISCREPANCY: 'Tax Calculation Discrepancy',
  MISSING_INFO: 'Missing / Inconsistent Information',
  UNUSUAL_AMOUNT: 'Unusual Transaction Amount',
  REPEATED_REFUND: 'Repeated Refund Pattern',
  SUSPICIOUS_FREQUENCY: 'Suspicious Invoice Frequency',
  SALES_RECONCILIATION: 'Sales Reconciliation Difference',
  POTENTIAL_UNDER_REPORTING: 'Potential Under-Reporting',
  ML_ANOMALY: 'ML Anomaly Indicator',
};

module.exports = { DETECTION_VERSION, DEFAULT_THRESHOLDS, RULE_WEIGHTS, CATEGORY_LABELS };
