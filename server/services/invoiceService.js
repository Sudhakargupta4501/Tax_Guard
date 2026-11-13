'use strict';
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const { nextSequence } = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { toPaise, fromPaise } = require('../utils/money');
const tax = require('./taxService');
const { getBusinessProfile } = require('./settingsService');

const DAY = 24 * 60 * 60 * 1000;

function derivePaymentStatus(grandTotal, amountPaid) {
  const paid = toPaise(amountPaid);
  if (paid <= 0) return 'Unpaid';
  if (paid >= toPaise(grandTotal)) return 'Paid';
  return 'Partially Paid';
}

const formatAddress = (a = {}) => [a.line1, a.city, a.state, a.pincode].filter(Boolean).join(', ');

/**
 * Builds validated, server-calculated line items. Tax rates and (default) prices come from the
 * database, never from the client, so totals cannot be tampered with from the browser.
 */
async function buildLines(items, customer, invoiceDate, profile) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const intraState = tax.isIntraState(profile.stateCode, customer.stateCode);
  const cfgCache = new Map();

  const lines = [];
  for (const [index, item] of items.entries()) {
    const product = byId.get(item.productId);
    if (!product || product.isArchived) {
      throw ApiError.unprocessable(`Item ${index + 1}: product not found or archived`);
    }
    if (!cfgCache.has(product.taxCategory)) cfgCache.set(product.taxCategory, await tax.resolveTaxConfig(product.taxCategory, invoiceDate));
    const cfg = cfgCache.get(product.taxCategory);
    const unitPrice = item.unitPrice ?? product.unitPrice;
    const calc = tax.computeLine(
      { quantity: item.quantity, unitPrice, discountPercent: item.discountPercent || 0, taxRate: cfg.rate },
      { intraState }
    );
    lines.push({
      calc,
      doc: {
        product: product._id,
        name: product.name,
        description: item.description || product.description,
        sku: product.sku,
        hsnSac: product.hsnSac,
        quantity: item.quantity,
        unitPrice,
        discountPercent: item.discountPercent || 0,
        taxCategory: product.taxCategory,
        taxRate: cfg.rate,
        ...tax.lineToRupees(calc),
      },
    });
  }
  const totals = tax.totalsToRupees(tax.sumLines(lines.map((l) => l.calc)));
  return { lineDocs: lines.map((l) => l.doc), totals, supplyType: intraState ? 'intra' : 'inter' };
}

async function reserveInventory(lineDocs) {
  const done = [];
  try {
    for (const l of lineDocs) {
      const product = await Product.findById(l.product).select('trackInventory name');
      if (!product?.trackInventory) continue;
      const res = await Product.updateOne({ _id: l.product, inventoryQuantity: { $gte: l.quantity } }, { $inc: { inventoryQuantity: -l.quantity } });
      if (res.modifiedCount !== 1) throw ApiError.conflict(`Insufficient stock for "${product.name}"`);
      done.push(l);
    }
  } catch (err) {
    await releaseInventory(done);
    throw err;
  }
}

async function releaseInventory(lineDocs) {
  for (const l of lineDocs) {
    const product = await Product.findById(l.product).select('trackInventory');
    if (product?.trackInventory) await Product.updateOne({ _id: l.product }, { $inc: { inventoryQuantity: l.quantity } });
  }
}

function resolveDates(invoiceDateInput, dueDateInput) {
  const now = new Date();
  const invoiceDate = invoiceDateInput ? new Date(invoiceDateInput) : now;
  if (invoiceDate.getTime() > now.getTime() + DAY) throw ApiError.badRequest('Invoice date cannot be in the future');
  const dueDate = dueDateInput ? new Date(dueDateInput) : new Date(invoiceDate.getTime() + 30 * DAY);
  if (dueDate < invoiceDate) throw ApiError.badRequest('Due date cannot be earlier than the invoice date');
  return { invoiceDate, dueDate };
}

async function createInvoice(payload, user) {
  const customer = await Customer.findById(payload.customerId);
  if (!customer || customer.isArchived) throw ApiError.unprocessable('Customer not found or archived');
  const profile = await getBusinessProfile();
  const { invoiceDate, dueDate } = resolveDates(payload.invoiceDate, payload.dueDate);
  const { lineDocs, totals, supplyType } = await buildLines(payload.items, customer, invoiceDate, profile);

  await reserveInventory(lineDocs);
  try {
    const year = invoiceDate.getFullYear();
    const seq = await nextSequence(`invoice-${year}`);
    const invoiceNumber = `INV-${year}-${String(seq).padStart(5, '0')}`;
    return await Invoice.create({
      invoiceNumber,
      externalReference: payload.externalReference,
      customer: customer._id,
      customerSnapshot: {
        name: customer.name,
        email: customer.email,
        address: formatAddress(customer.address),
        gstin: customer.gstin,
        stateCode: customer.stateCode,
      },
      supplierStateCode: profile.stateCode,
      supplyType,
      items: lineDocs,
      ...totals,
      amountPaid: 0,
      outstanding: totals.grandTotal,
      invoiceDate,
      dueDate,
      paymentStatus: 'Unpaid',
      status: 'Issued',
      notes: payload.notes,
      createdBy: user._id,
    });
  } catch (err) {
    await releaseInventory(lineDocs);
    throw err;
  }
}

/** Updates an eligible invoice. Returns { invoice, changes } for audit logging. */
async function updateInvoice(invoice, payload, user, { canCancel }) {
  if (invoice.status === 'Cancelled') throw ApiError.conflict('Cancelled invoices cannot be modified');
  const changes = {};

  if (payload.status === 'Cancelled') {
    if (!canCancel) throw ApiError.forbidden('Only an administrator or business owner can cancel invoices');
    if (toPaise(invoice.amountPaid) > 0) throw ApiError.conflict('Invoice has recorded payments. Refund them before cancelling.');
    if (!payload.cancelReason) throw ApiError.badRequest('A cancellation reason is required');
    await releaseInventory(invoice.items);
    changes.status = { from: invoice.status, to: 'Cancelled' };
    invoice.status = 'Cancelled';
    invoice.cancelReason = payload.cancelReason;
    invoice.outstanding = 0;
  } else {
    if (payload.items) {
      if (toPaise(invoice.amountPaid) > 0) throw ApiError.conflict('Items cannot be changed after payments were recorded');
      const customer = await Customer.findById(invoice.customer);
      const profile = await getBusinessProfile();
      const { lineDocs, totals, supplyType } = await buildLines(payload.items, customer, invoice.invoiceDate, profile);
      await releaseInventory(invoice.items);
      try {
        await reserveInventory(lineDocs);
      } catch (err) {
        await reserveInventory(invoice.items).catch(() => {}); // restore previous reservation
        throw err;
      }
      changes.grandTotal = { from: invoice.grandTotal, to: totals.grandTotal };
      changes.itemCount = { from: invoice.items.length, to: lineDocs.length };
      invoice.items = lineDocs;
      invoice.set({ ...totals, supplyType });
      invoice.outstanding = fromPaise(toPaise(totals.grandTotal) - toPaise(invoice.amountPaid));
      invoice.paymentStatus = derivePaymentStatus(invoice.grandTotal, invoice.amountPaid);
    }
    if (payload.dueDate) {
      if (new Date(payload.dueDate) < invoice.invoiceDate) throw ApiError.badRequest('Due date cannot be earlier than the invoice date');
      changes.dueDate = { from: invoice.dueDate, to: payload.dueDate };
      invoice.dueDate = payload.dueDate;
    }
    if (payload.notes !== undefined && payload.notes !== invoice.notes) {
      changes.notes = { from: invoice.notes, to: payload.notes };
      invoice.notes = payload.notes;
    }
  }
  invoice.updatedBy = user._id;
  await invoice.save();
  return { invoice, changes };
}

module.exports = { createInvoice, updateInvoice, derivePaymentStatus, formatAddress };
