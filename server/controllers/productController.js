'use strict';
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const TaxConfiguration = require('../models/TaxConfiguration');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok, paginate, pageMeta, escapeRegex } = require('../utils/helpers');
const { logAudit, diffFields } = require('../utils/audit');

const FIELDS = ['name', 'description', 'sku', 'hsnSac', 'unitPrice', 'taxCategory', 'taxRate', 'trackInventory', 'inventoryQuantity'];

async function assertTaxConsistent(category, rate) {
  const cfg = await TaxConfiguration.findOne({ category, isActive: true }).sort({ effectiveDate: -1 }).lean();
  if (!cfg) throw ApiError.unprocessable(`Tax category "${category}" is not configured. Create it under Settings > Tax configuration first.`);
  if (Number(cfg.rate) !== Number(rate)) throw ApiError.unprocessable(`Tax rate ${rate}% does not match the configured rate ${cfg.rate}% for category "${category}"`);
}

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.includeArchived !== 'true') filter.isArchived = false;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ name: rx }, { sku: rx }];
  }
  const [rows, total] = await Promise.all([Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);
  ok(res, rows, { pagination: pageMeta(page, limit, total) });
});

exports.create = asyncHandler(async (req, res) => {
  await assertTaxConsistent(req.body.taxCategory, req.body.taxRate);
  const product = await Product.create({ ...req.body, createdBy: req.user._id });
  await logAudit(req, { action: 'product.create', entityType: 'Product', entityId: product._id, summary: { name: product.name, sku: product.sku, unitPrice: product.unitPrice } });
  ok(res, product, { message: 'Product created' }, 201);
});

exports.get = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) throw ApiError.notFound('Product not found');
  ok(res, product);
});

exports.update = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  await assertTaxConsistent(req.body.taxCategory, req.body.taxRate);
  const before = product.toObject();
  product.set(req.body);
  await product.save();
  await logAudit(req, { action: 'product.update', entityType: 'Product', entityId: product._id, summary: diffFields(before, product.toObject(), FIELDS) });
  ok(res, product, { message: 'Product updated' });
});

exports.remove = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  const used = await Invoice.exists({ 'items.product': product._id });
  if (used) {
    product.isArchived = true;
    await product.save();
    await logAudit(req, { action: 'product.archive', entityType: 'Product', entityId: product._id, summary: { name: product.name } });
    return ok(res, { archived: true }, { message: 'Product is used on invoices, so it was archived instead of deleted' });
  }
  await product.deleteOne();
  await logAudit(req, { action: 'product.delete', entityType: 'Product', entityId: product._id, summary: { name: product.name } });
  return ok(res, { deleted: true }, { message: 'Product deleted' });
});
