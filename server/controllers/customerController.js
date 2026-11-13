'use strict';
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok, paginate, pageMeta, escapeRegex } = require('../utils/helpers');
const { logAudit, diffFields } = require('../utils/audit');

const FIELDS = ['name', 'email', 'phone', 'address', 'stateCode', 'gstin'];

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.includeArchived !== 'true') filter.isArchived = false;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { gstin: rx }];
  }
  const [rows, total] = await Promise.all([Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Customer.countDocuments(filter)]);
  ok(res, rows, { pagination: pageMeta(page, limit, total) });
});

exports.create = asyncHandler(async (req, res) => {
  const customer = await Customer.create({ ...req.body, createdBy: req.user._id });
  await logAudit(req, { action: 'customer.create', entityType: 'Customer', entityId: customer._id, summary: { name: customer.name } });
  ok(res, customer, { message: 'Customer created' }, 201);
});

exports.get = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) throw ApiError.notFound('Customer not found');
  const [agg] = await Invoice.aggregate([
    { $match: { customer: customer._id, status: 'Issued' } },
    { $group: { _id: null, invoices: { $sum: 1 }, invoiced: { $sum: '$grandTotal' }, paid: { $sum: '$amountPaid' }, outstanding: { $sum: '$outstanding' } } },
  ]);
  const invoices = await Invoice.find({ customer: customer._id }).sort({ invoiceDate: -1 }).limit(25)
    .select('invoiceNumber invoiceDate dueDate grandTotal amountPaid outstanding paymentStatus status').lean();
  ok(res, { customer, billing: { invoiceCount: agg?.invoices || 0, totalInvoiced: agg?.invoiced || 0, totalPaid: agg?.paid || 0, outstanding: agg?.outstanding || 0, invoices } });
});

exports.update = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');
  const before = customer.toObject();
  customer.set(req.body);
  await customer.save();
  await logAudit(req, { action: 'customer.update', entityType: 'Customer', entityId: customer._id, summary: diffFields(before, customer.toObject(), FIELDS) });
  ok(res, customer, { message: 'Customer updated' });
});

/** Customers with invoices are archived (financial history must stay intact); unused ones can be deleted. */
exports.remove = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');
  const hasInvoices = await Invoice.exists({ customer: customer._id });
  if (hasInvoices) {
    customer.isArchived = true;
    await customer.save();
    await logAudit(req, { action: 'customer.archive', entityType: 'Customer', entityId: customer._id, summary: { name: customer.name } });
    return ok(res, { archived: true }, { message: 'Customer has invoices, so it was archived instead of deleted' });
  }
  await customer.deleteOne();
  await logAudit(req, { action: 'customer.delete', entityType: 'Customer', entityId: customer._id, summary: { name: customer.name } });
  return ok(res, { deleted: true }, { message: 'Customer deleted' });
});
