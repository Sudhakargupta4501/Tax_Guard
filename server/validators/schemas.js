'use strict';
const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
const idParams = z.object({ id: objectId });
const emptyToUndef = (v) => (v === '' || v === null ? undefined : v);
const optStr = (max = 200) => z.preprocess(emptyToUndef, z.string().trim().max(max).optional());
const money = z.coerce.number().finite().min(0).max(1e9);
const stateCode = z.string().regex(/^(0[1-9]|[12]\d|3[0-8]|97|99)$/, 'Invalid GST state code');
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const gstin = z.preprocess(emptyToUndef, z.string().trim().toUpperCase().regex(GSTIN_RE, 'Invalid GSTIN format').optional());
const dateStr = z.coerce.date();

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/\d/, 'Password needs a number');

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
};

// ---------- auth ----------
const register = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
});
const login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });

// ---------- customers ----------
const customerBody = z
  .object({
    name: z.string().trim().min(2).max(150),
    email: z.preprocess(emptyToUndef, z.string().trim().toLowerCase().email().max(254).optional()),
    phone: z.preprocess(emptyToUndef, z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, 'Invalid phone number').optional()),
    address: z
      .object({ line1: optStr(200), city: optStr(100), state: optStr(100), pincode: z.preprocess(emptyToUndef, z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional()) })
      .default({}),
    stateCode,
    gstin,
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) {
      ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN state code must match the customer state code' });
    }
  });
const customerQuery = z.object({
  ...pagination,
  search: z.string().trim().max(100).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

// ---------- products ----------
const productBody = z.object({
  name: z.string().trim().min(2).max(150),
  description: optStr(500),
  sku: z.string().trim().toUpperCase().min(2).max(50),
  hsnSac: optStr(10),
  unitPrice: money,
  taxCategory: z.string().trim().min(1).max(50),
  taxRate: z.coerce.number().min(0).max(100),
  trackInventory: z.coerce.boolean().default(false),
  inventoryQuantity: z.coerce.number().min(0).max(1e9).default(0),
});
const productQuery = z.object({
  ...pagination,
  search: z.string().trim().max(100).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

// ---------- invoices ----------
const invoiceItem = z.object({
  productId: objectId,
  quantity: z.coerce.number().positive().max(1e7),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  unitPrice: z.preprocess(emptyToUndef, money.optional()),
  description: optStr(300),
});
const invoiceCreate = z.object({
  customerId: objectId,
  invoiceDate: z.preprocess(emptyToUndef, dateStr.optional()),
  dueDate: z.preprocess(emptyToUndef, dateStr.optional()),
  items: z.array(invoiceItem).min(1, 'Add at least one item').max(100),
  externalReference: optStr(60),
  notes: optStr(500),
});
const invoiceUpdate = z.object({
  dueDate: z.preprocess(emptyToUndef, dateStr.optional()),
  notes: optStr(500),
  items: z.array(invoiceItem).min(1).max(100).optional(),
  status: z.enum(['Cancelled']).optional(),
  cancelReason: optStr(300),
});
const invoiceQuery = z.object({
  ...pagination,
  search: z.string().trim().max(60).optional(),
  customer: objectId.optional(),
  paymentStatus: z.enum(['Unpaid', 'Partially Paid', 'Paid']).optional(),
  status: z.enum(['Issued', 'Cancelled']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

// ---------- payments ----------
const paymentBody = z.object({
  invoiceId: objectId,
  kind: z.enum(['payment', 'refund']).default('payment'),
  amount: z.coerce.number().positive().max(1e9),
  method: z.enum(['Cash', 'Bank Transfer', 'UPI', 'Card', 'Cheque', 'Other']),
  paymentDate: z.preprocess(emptyToUndef, dateStr.optional()),
  transactionReference: optStr(80),
  notes: optStr(300),
  idempotencyKey: optStr(80),
});
const paymentQuery = z.object({
  ...pagination,
  invoice: objectId.optional(),
  kind: z.enum(['payment', 'refund']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

// ---------- fraud ----------
const CATEGORY_ENUM = [
  'DUPLICATE_INVOICE', 'INCORRECT_TOTAL', 'TAX_DISCREPANCY', 'MISSING_INFO', 'UNUSUAL_AMOUNT',
  'REPEATED_REFUND', 'SUSPICIOUS_FREQUENCY', 'SALES_RECONCILIATION', 'POTENTIAL_UNDER_REPORTING', 'ML_ANOMALY',
];
const fraudQuery = z.object({
  ...pagination,
  search: z.string().trim().max(60).optional(),
  category: z.enum(CATEGORY_ENUM).optional(),
  severity: z.enum(['Low', 'Medium', 'High']).optional(),
  reviewStatus: z.enum(['New', 'Under Review', 'Resolved', 'False Positive']).optional(),
  invoice: objectId.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
const analyzeBody = z.object({
  invoiceId: objectId.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  includeMl: z.coerce.boolean().default(false),
});
const reviewBody = z.object({
  reviewStatus: z.enum(['New', 'Under Review', 'Resolved', 'False Positive']).optional(),
  comment: optStr(1000),
  resolutionNotes: optStr(1000),
  assignedReviewer: z.preprocess(emptyToUndef, objectId.optional()),
});
const transactionImport = z.object({
  records: z
    .array(
      z.object({
        reference: optStr(80),
        date: dateStr,
        amount: z.coerce.number().min(0).max(1e10),
        direction: z.enum(['credit', 'debit']).default('credit'),
        description: optStr(200),
      })
    )
    .min(1)
    .max(1000),
  source: optStr(60),
});

// ---------- reports ----------
const rangeQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

// ---------- admin ----------
const taxConfigBody = z.object({
  name: z.string().trim().min(2).max(100),
  rate: z.coerce.number().min(0).max(100),
  category: z.string().trim().min(1).max(50),
  effectiveDate: z.preprocess(emptyToUndef, dateStr.optional()),
  isActive: z.coerce.boolean().default(true),
  metadata: z.record(z.any()).optional(),
});
const taxConfigUpdate = taxConfigBody.partial();
const userUpdate = z.object({
  role: z.enum(['admin', 'business_owner', 'accountant', 'reviewer']).optional(),
  accountStatus: z.enum(['active', 'disabled']).optional(),
});
const profileUpdate = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  currentPassword: z.string().max(128).optional(),
  newPassword: password.optional(),
});
const businessProfile = z.object({
  name: z.string().trim().min(2).max(150),
  gstin,
  stateCode,
  address: optStr(300),
  email: z.preprocess(emptyToUndef, z.string().trim().email().optional()),
  phone: optStr(20),
});
const thresholds = z
  .object({
    amountToleranceRupees: z.coerce.number().min(0).max(1000),
    duplicateWindowDays: z.coerce.number().int().min(0).max(365),
    unusualAmountZScore: z.coerce.number().min(1).max(20),
    unusualAmountMinHistory: z.coerce.number().int().min(3).max(1000),
    invoicesPerCustomerPerDay: z.coerce.number().int().min(2).max(500),
    refundCountThreshold: z.coerce.number().int().min(2).max(100),
    refundWindowDays: z.coerce.number().int().min(1).max(365),
    gstinRequiredAboveRupees: z.coerce.number().min(0),
    reconciliationTolerancePct: z.coerce.number().min(0).max(100),
    underReportingThresholdPct: z.coerce.number().min(0).max(100),
    mediumSeverityFrom: z.coerce.number().min(1).max(99),
    highSeverityFrom: z.coerce.number().min(1).max(100),
  })
  .partial()
  .refine((t) => !(t.mediumSeverityFrom && t.highSeverityFrom) || t.mediumSeverityFrom < t.highSeverityFrom, {
    message: 'Medium threshold must be lower than High threshold',
  });
const taxConfigQuery = z.object({ active: z.enum(['true', 'false']).optional() });
const auditQuery = z.object({
  ...pagination,
  entityType: z.string().max(50).optional(),
  action: z.string().max(80).optional(),
  user: objectId.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
const userQuery = z.object({ ...pagination, search: z.string().trim().max(100).optional() });

module.exports = {
  idParams, register, login, customerBody, customerQuery, productBody, productQuery, invoiceCreate, invoiceUpdate,
  invoiceQuery, paymentBody, paymentQuery, fraudQuery, analyzeBody, reviewBody, transactionImport, rangeQuery,
  taxConfigBody, taxConfigUpdate, userUpdate, profileUpdate, businessProfile, thresholds, taxConfigQuery, auditQuery,
  userQuery, CATEGORY_ENUM,
};
