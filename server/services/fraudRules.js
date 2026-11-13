'use strict';
/**
 * Pure (database-free) fraud-risk rules. Each rule returns `null` or a finding:
 *   { category, rules: [{ruleId, name, weight, detail, evidence}], base, magnitude, description }
 * `base` comes from RULE_WEIGHTS; `magnitude` (0-20) scales with the size of the discrepancy.
 * Findings are INDICATORS FOR HUMAN REVIEW, not conclusions about fraud.
 */
const { RULE_WEIGHTS } = require('../config/fraudConfig');
const { toPaise, fromPaise } = require('../utils/money');
const { computeLine } = require('./taxService');

const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET = 5.5 * 60 * 60 * 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const money = (p) => fromPaise(p).toFixed(2);
const dayKey = (d) => new Date(new Date(d).getTime() + IST_OFFSET).toISOString().slice(0, 10);
const monthKey = (d) => dayKey(d).slice(0, 7);

function safePaise(v) {
  try {
    return toPaise(v ?? 0);
  } catch {
    return NaN;
  }
}

function expectedLine(it, supplyType) {
  return computeLine(
    { quantity: it.quantity, unitPrice: it.unitPrice, discountPercent: it.discountPercent || 0, taxRate: it.taxRate },
    { intraState: supplyType === 'intra' }
  );
}

// ---------------------------------------------------------------------------
// Rule: incorrect totals (internal arithmetic that does not involve tax rates)
// ---------------------------------------------------------------------------
function checkIncorrectTotal(inv, th) {
  const tolP = Math.round(th.amountToleranceRupees * 100);
  const issues = [];
  let maxDiff = 0;
  const add = (field, stored, expected) => {
    const diff = Math.abs(stored - expected);
    if (diff > tolP) {
      issues.push({ field, stored: money(stored), expected: money(expected), difference: money(diff) });
      maxDiff = Math.max(maxDiff, diff);
    }
  };
  let sumGross = 0, sumDisc = 0, sumTaxable = 0;
  (inv.items || []).forEach((it, i) => {
    let exp;
    try {
      exp = expectedLine(it, inv.supplyType);
    } catch {
      return; // unparsable line values are reported by the missing-info rule
    }
    const label = `item ${i + 1} (${it.name})`;
    add(`${label} gross`, safePaise(it.grossAmount), exp.gross);
    add(`${label} discount`, safePaise(it.discountAmount), exp.discount);
    add(`${label} taxable`, safePaise(it.taxableAmount), exp.taxable);
    add(`${label} line total`, safePaise(it.lineTotal), safePaise(it.taxableAmount) + safePaise(it.taxAmount));
    sumGross += safePaise(it.grossAmount);
    sumDisc += safePaise(it.discountAmount);
    sumTaxable += safePaise(it.taxableAmount);
  });
  add('subtotal', safePaise(inv.subtotal), sumGross);
  add('discount', safePaise(inv.discount), sumDisc);
  add('taxable amount', safePaise(inv.taxableAmount), sumTaxable);
  add('grand total', safePaise(inv.grandTotal), safePaise(inv.taxableAmount) + safePaise(inv.taxBreakdown?.totalTax));

  if (!issues.length) return null;
  const rel = (maxDiff / Math.max(safePaise(inv.grandTotal), 100)) * 100;
  return {
    category: 'INCORRECT_TOTAL',
    base: RULE_WEIGHTS.INCORRECT_TOTAL,
    magnitude: clamp(Math.round(rel * 2), 0, 20),
    description: `Stored amounts on ${inv.invoiceNumber} do not add up: ${issues.map((i) => `${i.field} is ${i.stored} but should be ${i.expected}`).slice(0, 4).join('; ')}${issues.length > 4 ? ` (+${issues.length - 4} more)` : ''}.`,
    rules: [
      { ruleId: 'TOTAL_ARITHMETIC', name: 'Invoice arithmetic check', weight: RULE_WEIGHTS.INCORRECT_TOTAL, detail: `${issues.length} amount(s) differ from recomputed values by more than ${th.amountToleranceRupees}`, evidence: { issues } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rule: tax discrepancies (tax amounts, CGST/SGST/IGST split, rate vs configuration, supply type)
// ---------------------------------------------------------------------------
function checkTaxDiscrepancy(inv, ctx, th) {
  const tolP = Math.round(th.amountToleranceRupees * 100);
  const intra = inv.supplyType === 'intra';
  const rules = [];
  const amountIssues = [];
  const splitIssues = [];
  const rateIssues = [];
  let maxRelPct = 0;
  let sumTax = 0, sumC = 0, sumS = 0, sumI = 0;

  (inv.items || []).forEach((it, i) => {
    let exp;
    try {
      exp = expectedLine(it, inv.supplyType);
    } catch {
      return;
    }
    const label = `item ${i + 1} (${it.name})`;
    const tax = safePaise(it.taxAmount);
    const c = safePaise(it.cgst), s = safePaise(it.sgst), g = safePaise(it.igst);
    sumTax += tax; sumC += c; sumS += s; sumI += g;

    const diff = Math.abs(tax - exp.tax);
    if (diff > tolP) {
      amountIssues.push({ item: label, rate: it.taxRate, storedTax: money(tax), expectedTax: money(exp.tax) });
      maxRelPct = Math.max(maxRelPct, exp.tax > 0 ? (diff / exp.tax) * 100 : 100);
    }
    if (intra ? g !== 0 || Math.abs(c - s) > 1 : c !== 0 || s !== 0) {
      splitIssues.push({ item: label, cgst: money(c), sgst: money(s), igst: money(g), expectedSupply: intra ? 'CGST+SGST' : 'IGST' });
    } else if (Math.abs(c + s + g - tax) > 1) {
      splitIssues.push({ item: label, note: 'CGST + SGST + IGST does not equal the line tax', cgst: money(c), sgst: money(s), igst: money(g), tax: money(tax) });
    }
    const cfg = ctx.configFor ? ctx.configFor(it.taxCategory, inv.invoiceDate) : null;
    if (cfg && Number(cfg.rate) !== Number(it.taxRate)) {
      rateIssues.push({ item: label, appliedRate: it.taxRate, configuredRate: cfg.rate, category: it.taxCategory });
      maxRelPct = Math.max(maxRelPct, 25);
    }
  });

  const bd = inv.taxBreakdown || {};
  const headerIssues = [];
  [['totalTax', sumTax], ['cgst', sumC], ['sgst', sumS], ['igst', sumI]].forEach(([k, sum]) => {
    const stored = safePaise(bd[k]);
    if (Math.abs(stored - sum) > tolP) {
      headerIssues.push({ field: `taxBreakdown.${k}`, stored: money(stored), expected: money(sum) });
      maxRelPct = Math.max(maxRelPct, sum > 0 ? (Math.abs(stored - sum) / sum) * 100 : 100);
    }
  });

  const customerState = inv.customerSnapshot?.stateCode;
  let supplyIssue = null;
  if (customerState && inv.supplierStateCode) {
    const expectedIntra = customerState === inv.supplierStateCode;
    if (expectedIntra !== intra) {
      supplyIssue = { supplierState: inv.supplierStateCode, customerState, recordedSupply: inv.supplyType, expectedSupply: expectedIntra ? 'intra' : 'inter' };
      maxRelPct = Math.max(maxRelPct, 50);
    }
  }

  const w = RULE_WEIGHTS.TAX_DISCREPANCY;
  if (amountIssues.length) rules.push({ ruleId: 'TAX_AMOUNT_MISMATCH', name: 'Tax amount differs from rate x taxable value', weight: w, detail: `${amountIssues.length} line(s)`, evidence: { amountIssues } });
  if (headerIssues.length) rules.push({ ruleId: 'TAX_TOTAL_MISMATCH', name: 'Tax breakdown does not match line items', weight: w, detail: `${headerIssues.length} field(s)`, evidence: { headerIssues } });
  if (splitIssues.length) rules.push({ ruleId: 'TAX_SPLIT_INVALID', name: 'CGST/SGST/IGST split inconsistent with supply type', weight: w, detail: `${splitIssues.length} line(s)`, evidence: { splitIssues } });
  if (rateIssues.length) rules.push({ ruleId: 'TAX_RATE_NOT_CONFIGURED', name: 'Applied rate differs from configured rate', weight: w, detail: `${rateIssues.length} line(s)`, evidence: { rateIssues } });
  if (supplyIssue) rules.push({ ruleId: 'SUPPLY_TYPE_MISMATCH', name: 'Intra/inter-state treatment inconsistent with state codes', weight: w, detail: 'Place of supply', evidence: supplyIssue });
  if (!rules.length) return null;

  const parts = [];
  if (amountIssues[0]) parts.push(`${amountIssues[0].item} shows tax ${amountIssues[0].storedTax} but ${amountIssues[0].taxRate}% of the taxable value is ${amountIssues[0].expectedTax}`);
  if (headerIssues[0]) parts.push(`${headerIssues[0].field} is ${headerIssues[0].stored} versus ${headerIssues[0].expected} from line items`);
  if (splitIssues[0]) parts.push('GST split does not match the recorded supply type');
  if (rateIssues[0]) parts.push(`${rateIssues[0].item} used ${rateIssues[0].appliedRate}% but the configured rate for ${rateIssues[0].category} is ${rateIssues[0].configuredRate}%`);
  if (supplyIssue) parts.push(`supply recorded as ${supplyIssue.recordedSupply}-state but state codes imply ${supplyIssue.expectedSupply}-state`);
  return {
    category: 'TAX_DISCREPANCY',
    base: w,
    magnitude: clamp(Math.round(maxRelPct / 5), 0, 20),
    description: `Tax values on ${inv.invoiceNumber} look inconsistent: ${parts.join('; ')}.`,
    rules,
  };
}

// ---------------------------------------------------------------------------
// Rule: missing or inconsistent information
// ---------------------------------------------------------------------------
function checkMissingInfo(inv, th, now = new Date()) {
  const issues = [];
  const snap = inv.customerSnapshot || {};
  if (!snap.name) issues.push('customer name is missing');
  if (!snap.address) issues.push('customer billing address is missing');
  if (!inv.dueDate) issues.push('due date is missing');
  if (!snap.gstin && Number(inv.grandTotal) >= th.gstinRequiredAboveRupees) issues.push(`no customer GSTIN recorded on an invoice of ${Number(inv.grandTotal).toFixed(2)} (threshold ${th.gstinRequiredAboveRupees})`);
  if (!inv.items || !inv.items.length) issues.push('invoice has no line items');
  (inv.items || []).forEach((it, i) => {
    if (!it.name) issues.push(`item ${i + 1} has no name`);
    if (!(Number(it.quantity) > 0)) issues.push(`item ${i + 1} has an invalid quantity`);
  });
  if (inv.invoiceDate && new Date(inv.invoiceDate).getTime() > now.getTime() + DAY) issues.push('invoice date is in the future');
  if (inv.invoiceDate && inv.dueDate && new Date(inv.dueDate) < new Date(inv.invoiceDate)) issues.push('due date is before the invoice date');

  const grand = safePaise(inv.grandTotal), paid = safePaise(inv.amountPaid), out = safePaise(inv.outstanding);
  if (inv.status === 'Issued' && Math.abs(grand - paid - out) > 1) issues.push(`outstanding (${money(out)}) does not equal total (${money(grand)}) minus paid (${money(paid)})`);
  if (paid > grand) issues.push('amount paid exceeds the invoice total');
  if (inv.status === 'Issued') {
    const expectedStatus = paid <= 0 ? 'Unpaid' : paid >= grand ? 'Paid' : 'Partially Paid';
    if (inv.paymentStatus !== expectedStatus) issues.push(`payment status is "${inv.paymentStatus}" but amounts imply "${expectedStatus}"`);
  }
  if (!issues.length) return null;
  return {
    category: 'MISSING_INFO',
    base: RULE_WEIGHTS.MISSING_INFO,
    magnitude: clamp(issues.length * 4, 0, 20),
    description: `${inv.invoiceNumber} has missing or inconsistent information: ${issues.slice(0, 4).join('; ')}${issues.length > 4 ? ` (+${issues.length - 4} more)` : ''}.`,
    rules: [{ ruleId: 'INFO_COMPLETENESS', name: 'Completeness and consistency check', weight: RULE_WEIGHTS.MISSING_INFO, detail: `${issues.length} issue(s)`, evidence: { issues } }],
  };
}

// ---------------------------------------------------------------------------
// Rule: unusual amount (robust modified z-score against history)
// ---------------------------------------------------------------------------
function medianMad(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const med = (arr) => (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  const median = med(sorted);
  const mad = med(sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b));
  return { median, mad, n: values.length };
}

function checkUnusualAmount(inv, stats, th) {
  if (!stats || stats.n < th.unusualAmountMinHistory) return null; // not enough history to judge
  const amount = Number(inv.grandTotal);
  const scale = stats.mad > 0 ? stats.mad : Math.max(stats.median * 0.1, 1); // fall back if MAD is zero
  const z = (0.6745 * (amount - stats.median)) / scale;
  if (z < th.unusualAmountZScore) return null;
  return {
    category: 'UNUSUAL_AMOUNT',
    base: RULE_WEIGHTS.UNUSUAL_AMOUNT,
    magnitude: clamp(Math.round((z - th.unusualAmountZScore) * 2), 0, 15),
    description: `${inv.invoiceNumber} total ${amount.toFixed(2)} is far above the typical invoice (median ${stats.median.toFixed(2)} over ${stats.n} invoices; modified z-score ${z.toFixed(1)}). A single large invoice can be legitimate; review in context.`,
    rules: [{ ruleId: 'AMOUNT_OUTLIER', name: 'Robust outlier (median/MAD) on invoice total', weight: RULE_WEIGHTS.UNUSUAL_AMOUNT, detail: `z=${z.toFixed(2)} >= ${th.unusualAmountZScore}`, evidence: { amount, median: stats.median, mad: stats.mad, sample: stats.n, zScore: Number(z.toFixed(2)) } }],
  };
}

// ---------------------------------------------------------------------------
// Rule: duplicates (returns Map<invoiceId, finding>)
// ---------------------------------------------------------------------------
const normaliseNumber = (s) => String(s || '').replace(/[\s_-]+/g, '').toUpperCase();
const itemSignature = (inv) => (inv.items || []).map((i) => `${i.product || i.sku || i.name}:${i.quantity}:${i.unitPrice}`).sort().join('|');

function findDuplicates(invoices, th) {
  const result = new Map();
  const ordered = [...invoices].sort((a, b) => new Date(a.createdAt || a.invoiceDate) - new Date(b.createdAt || b.invoiceDate));
  const groups = new Map();
  const push = (key, reason, inv) => {
    if (!groups.has(key)) groups.set(key, { reason, members: [] });
    groups.get(key).members.push(inv);
  };
  ordered.forEach((inv) => {
    push(`num:${normaliseNumber(inv.invoiceNumber)}`, 'same invoice number (ignoring case/spacing)', inv);
    if (inv.externalReference) push(`ext:${normaliseNumber(inv.externalReference)}`, 'same external reference', inv);
    push(`sig:${inv.customer}|${safePaise(inv.grandTotal)}|${itemSignature(inv)}`, `same customer, total and items within ${th.duplicateWindowDays} day(s)`, inv);
  });
  const windowMs = th.duplicateWindowDays * DAY;
  groups.forEach((g) => {
    if (g.members.length < 2) return;
    g.members.forEach((inv, idx) => {
      if (idx === 0) return; // the earliest record is treated as the original
      const original = g.members.slice(0, idx).find((m) => g.reason.startsWith('same customer') ? Math.abs(new Date(inv.invoiceDate) - new Date(m.invoiceDate)) <= windowMs : true);
      if (!original) return;
      const key = String(inv._id);
      const existing = result.get(key) || { reasons: [], originals: new Set() };
      existing.reasons.push(g.reason);
      existing.originals.add(original.invoiceNumber);
      result.set(key, existing);
    });
  });
  const out = new Map();
  result.forEach((v, key) => {
    const inv = invoices.find((i) => String(i._id) === key);
    const originals = [...v.originals];
    out.set(key, {
      category: 'DUPLICATE_INVOICE',
      base: RULE_WEIGHTS.DUPLICATE_INVOICE,
      magnitude: clamp(v.reasons.length * 5, 0, 15),
      description: `${inv.invoiceNumber} appears to duplicate ${originals.join(', ')} (${[...new Set(v.reasons)].join('; ')}). Confirm whether this is a genuine repeat sale.`,
      rules: [{ ruleId: 'DUPLICATE_MATCH', name: 'Duplicate invoice indicators', weight: RULE_WEIGHTS.DUPLICATE_INVOICE, detail: [...new Set(v.reasons)].join('; '), evidence: { originals, reasons: [...new Set(v.reasons)] } }],
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rule: suspicious frequency (many invoices to one customer on one day)
// ---------------------------------------------------------------------------
function findFrequencyBursts(invoices, th) {
  const buckets = new Map();
  invoices.forEach((inv) => {
    const key = `${inv.customer}|${dayKey(inv.invoiceDate)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(inv);
  });
  const out = new Map();
  buckets.forEach((list, key) => {
    if (list.length < th.invoicesPerCustomerPerDay) return;
    list.sort((a, b) => new Date(a.createdAt || a.invoiceDate) - new Date(b.createdAt || b.invoiceDate));
    const latest = list[list.length - 1];
    out.set(String(latest._id), {
      category: 'SUSPICIOUS_FREQUENCY',
      base: RULE_WEIGHTS.SUSPICIOUS_FREQUENCY,
      magnitude: clamp((list.length - th.invoicesPerCustomerPerDay) * 3, 0, 15),
      description: `${list.length} invoices were issued to the same customer on ${key.split('|')[1]} (threshold ${th.invoicesPerCustomerPerDay}), latest being ${latest.invoiceNumber}. Bursts can be legitimate (e.g. batch billing) but are worth a look.`,
      rules: [{ ruleId: 'INVOICE_BURST', name: 'Many invoices to one customer in a day', weight: RULE_WEIGHTS.SUSPICIOUS_FREQUENCY, detail: `${list.length} >= ${th.invoicesPerCustomerPerDay}`, evidence: { count: list.length, day: key.split('|')[1], invoices: list.map((i) => i.invoiceNumber) } }],
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rule: repeated refunds (returns array of {payment, invoice, finding})
// ---------------------------------------------------------------------------
function findRepeatedRefunds(refunds, invoiceById, th) {
  const byCustomer = new Map();
  refunds.forEach((r) => {
    const inv = invoiceById.get(String(r.invoice));
    if (!inv) return;
    const key = String(inv.customer);
    if (!byCustomer.has(key)) byCustomer.set(key, []);
    byCustomer.get(key).push({ ...r, _inv: inv });
  });
  const out = [];
  const windowMs = th.refundWindowDays * DAY;
  byCustomer.forEach((list) => {
    list.sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));
    list.forEach((r, idx) => {
      const inWindow = list.slice(0, idx + 1).filter((x) => new Date(r.paymentDate) - new Date(x.paymentDate) <= windowMs);
      if (inWindow.length < th.refundCountThreshold) return;
      const total = inWindow.reduce((s, x) => s + toPaise(x.amount), 0);
      out.push({
        payment: r,
        invoice: r._inv,
        finding: {
          category: 'REPEATED_REFUND',
          base: RULE_WEIGHTS.REPEATED_REFUND,
          magnitude: clamp((inWindow.length - th.refundCountThreshold) * 4, 0, 15),
          description: `${inWindow.length} refunds (total ${money(total)}) were recorded for ${r._inv.customerSnapshot?.name || 'the same customer'} within ${th.refundWindowDays} days, ending with a refund of ${Number(r.amount).toFixed(2)} on ${r._inv.invoiceNumber}.`,
          rules: [{ ruleId: 'REFUND_REPEAT', name: 'Repeated refunds for one customer', weight: RULE_WEIGHTS.REPEATED_REFUND, detail: `${inWindow.length} >= ${th.refundCountThreshold} in ${th.refundWindowDays} days`, evidence: { refundIds: inWindow.map((x) => String(x._id)), total: money(total) } }],
        },
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rule: monthly reconciliation of recorded sales vs supplied transaction records
// ---------------------------------------------------------------------------
function reconcileMonthly(invoices, txRecords, th) {
  const recorded = new Map();
  const supplied = new Map();
  invoices.forEach((i) => recorded.set(monthKey(i.invoiceDate), (recorded.get(monthKey(i.invoiceDate)) || 0) + toPaise(i.grandTotal)));
  txRecords.filter((t) => t.direction !== 'debit').forEach((t) => supplied.set(monthKey(t.date), (supplied.get(monthKey(t.date)) || 0) + toPaise(t.amount)));

  const rows = [];
  [...new Set([...supplied.keys()])].sort().forEach((month) => {
    const rec = recorded.get(month) || 0;
    const sup = supplied.get(month) || 0;
    const diff = rec - sup;
    const base = Math.max(rec, sup, 1);
    const pct = (Math.abs(diff) / base) * 100;
    let flag = null;
    if (diff < 0 && pct > th.underReportingThresholdPct) flag = 'POTENTIAL_UNDER_REPORTING';
    else if (pct > th.reconciliationTolerancePct) flag = 'SALES_RECONCILIATION';
    rows.push({ month, recorded: fromPaise(rec), supplied: fromPaise(sup), difference: fromPaise(diff), differencePct: Number(pct.toFixed(2)), flag });
  });
  return rows;
}

function reconciliationFinding(row, th) {
  const category = row.flag;
  const under = category === 'POTENTIAL_UNDER_REPORTING';
  return {
    category,
    base: RULE_WEIGHTS[category],
    magnitude: clamp(Math.round(row.differencePct / 2), 0, 20),
    description: under
      ? `For ${row.month}, recorded invoice sales (${row.recorded.toFixed(2)}) are ${Math.abs(row.difference).toFixed(2)} (${row.differencePct}%) lower than the supplied transaction records (${row.supplied.toFixed(2)}). Possible unrecorded sales, timing differences or incomplete data; this is an indicator, not a finding of under-reporting.`
      : `For ${row.month}, recorded invoice sales (${row.recorded.toFixed(2)}) differ from supplied transaction records (${row.supplied.toFixed(2)}) by ${Math.abs(row.difference).toFixed(2)} (${row.differencePct}%), above the ${th.reconciliationTolerancePct}% tolerance.`,
    rules: [{ ruleId: under ? 'RECON_UNDER' : 'RECON_DIFF', name: under ? 'Recorded sales below supplied transactions' : 'Recorded vs supplied sales difference', weight: RULE_WEIGHTS[category], detail: `${row.differencePct}% difference`, evidence: row }],
  };
}

function paymentReferenceMismatch(payment, txRecord, inv) {
  if (!txRecord || Math.abs(toPaise(txRecord.amount) - toPaise(payment.amount)) <= 1) return null;
  const diff = Math.abs(toPaise(txRecord.amount) - toPaise(payment.amount));
  return {
    category: 'SALES_RECONCILIATION',
    base: RULE_WEIGHTS.SALES_RECONCILIATION,
    magnitude: clamp(Math.round((diff / Math.max(toPaise(payment.amount), 100)) * 20), 0, 20),
    description: `Payment ${payment.transactionReference} on ${inv?.invoiceNumber || 'an invoice'} was recorded as ${Number(payment.amount).toFixed(2)} but the supplied transaction record shows ${Number(txRecord.amount).toFixed(2)}.`,
    rules: [{ ruleId: 'PAYMENT_REF_AMOUNT', name: 'Payment amount differs from supplied transaction', weight: RULE_WEIGHTS.SALES_RECONCILIATION, detail: `difference ${money(diff)}`, evidence: { reference: payment.transactionReference, recorded: payment.amount, supplied: txRecord.amount } }],
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function severityFor(score, th) {
  if (score >= th.highSeverityFrom) return 'High';
  if (score >= th.mediumSeverityFrom) return 'Medium';
  return 'Low';
}

/**
 * score = clamp(base + magnitude + corroboration, 0, 100)
 * corroboration = min(cap, bonus x (other distinct categories flagged on the same invoice)).
 * The same underlying issue is never counted twice because each category is evaluated once per invoice.
 */
function scoreFinding(finding, distinctCategories, th) {
  const others = Math.max(0, distinctCategories - 1);
  const corroboration = Math.min(th.corroborationBonusCap, others * th.corroborationBonus);
  let riskScore = clamp(Math.round(finding.base + finding.magnitude + corroboration), 0, 100);
  // A single statistical outlier with no corroborating category is never escalated above Low:
  // one unusual transaction is not evidence of wrongdoing.
  if (finding.category === 'UNUSUAL_AMOUNT' && others === 0) riskScore = Math.min(riskScore, Math.max(0, th.mediumSeverityFrom - 1));
  return { riskScore, severity: severityFor(riskScore, th), corroboration };
}

module.exports = {
  checkIncorrectTotal, checkTaxDiscrepancy, checkMissingInfo, checkUnusualAmount, medianMad,
  findDuplicates, findFrequencyBursts, findRepeatedRefunds, reconcileMonthly, reconciliationFinding,
  paymentReferenceMismatch, scoreFinding, severityFor, monthKey, dayKey,
};
