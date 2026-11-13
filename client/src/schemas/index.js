import { z } from 'zod';

// Frontend validation for UX only. The backend validates independently and is authoritative.
const emptyToUndef = (v) => (v === '' || v === null ? undefined : v);
const optional = (schema) => z.preprocess(emptyToUndef, schema.optional());

export const passwordRule = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
    password: passwordRule,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const customerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required (min 2 characters)').max(150),
    email: optional(z.string().trim().email('Enter a valid email')),
    phone: optional(z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, 'Enter a valid phone number')),
    line1: optional(z.string().trim().max(200)),
    city: optional(z.string().trim().max(100)),
    pincode: optional(z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits')),
    stateCode: z.string().min(1, 'Select a state'),
    gstin: optional(z.string().trim().toUpperCase().regex(GSTIN_RE, 'Invalid GSTIN format')),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN must start with the selected state code' });
  });

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(150),
  sku: z.string().trim().min(2, 'SKU is required').max(50),
  description: optional(z.string().trim().max(500)),
  hsnSac: optional(z.string().trim().max(10)),
  unitPrice: z.coerce.number({ invalid_type_error: 'Enter a price' }).min(0, 'Price cannot be negative'),
  taxCategory: z.string().min(1, 'Select a tax category'),
  trackInventory: z.boolean().default(false),
  inventoryQuantity: z.coerce.number().min(0, 'Cannot be negative').default(0),
});

export const invoiceSchema = z.object({
  customerId: z.string().min(1, 'Select a customer'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  dueDate: z.string().min(1, 'Due date is required'),
  notes: optional(z.string().max(500)),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'Select a product'),
        quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).positive('Must be greater than 0'),
        discountPercent: z.coerce.number().min(0, 'Min 0').max(100, 'Max 100').default(0),
      })
    )
    .min(1, 'Add at least one item'),
}).refine((d) => !d.dueDate || !d.invoiceDate || d.dueDate >= d.invoiceDate, { path: ['dueDate'], message: 'Due date cannot be before the invoice date' });

export const paymentSchema = z.object({
  invoiceId: z.string().min(1, 'Select an invoice'),
  kind: z.enum(['payment', 'refund']),
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).positive('Amount must be greater than 0'),
  method: z.enum(['Cash', 'Bank Transfer', 'UPI', 'Card', 'Cheque', 'Other']),
  paymentDate: z.string().min(1, 'Payment date is required'),
  transactionReference: optional(z.string().max(80)),
  notes: optional(z.string().max(300)),
});

export const reviewSchema = z
  .object({
    reviewStatus: z.enum(['New', 'Under Review', 'Resolved', 'False Positive']),
    comment: optional(z.string().max(1000)),
    resolutionNotes: optional(z.string().max(1000)),
  })
  .superRefine((v, ctx) => {
    if (['Resolved', 'False Positive'].includes(v.reviewStatus) && !v.resolutionNotes && !v.comment) {
      ctx.addIssue({ code: 'custom', path: ['resolutionNotes'], message: 'Document the reason for this decision' });
    }
  });

export const profileSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(100),
    currentPassword: optional(z.string()),
    newPassword: optional(passwordRule),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword && !v.currentPassword) ctx.addIssue({ code: 'custom', path: ['currentPassword'], message: 'Enter your current password' });
  });

export const businessSchema = z.object({
  name: z.string().trim().min(2, 'Business name is required'),
  gstin: optional(z.string().trim().toUpperCase().regex(GSTIN_RE, 'Invalid GSTIN format')),
  stateCode: z.string().min(1, 'Select a state'),
  address: optional(z.string().max(300)),
  email: optional(z.string().email('Enter a valid email')),
  phone: optional(z.string().max(20)),
});

export const taxConfigSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  category: z.string().trim().min(1, 'Category is required').max(50),
  rate: z.coerce.number({ invalid_type_error: 'Enter a rate' }).min(0).max(100),
  effectiveDate: optional(z.string()),
  isActive: z.boolean().default(true),
});

/** Parses pasted CSV (reference,date,amount,direction,description) into transaction import records. */
export function parseTransactionCsv(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return { records: [], errors: ['Paste at least one row.'] };
  const records = [];
  const errors = [];
  rows.forEach((line, i) => {
    const cols = line.split(',').map((c) => c.trim());
    if (i === 0 && /^reference$/i.test(cols[0])) return; // header
    const [reference, date, amount, direction = 'credit', ...desc] = cols;
    const d = new Date(date);
    const a = Number(amount);
    if (Number.isNaN(d.getTime())) errors.push(`Row ${i + 1}: invalid date "${date}"`);
    else if (!Number.isFinite(a) || a < 0) errors.push(`Row ${i + 1}: invalid amount "${amount}"`);
    else if (!['credit', 'debit'].includes(direction.toLowerCase())) errors.push(`Row ${i + 1}: direction must be credit or debit`);
    else records.push({ reference: reference || undefined, date: d.toISOString(), amount: a, direction: direction.toLowerCase(), description: desc.join(',') || undefined });
  });
  return { records, errors };
}
