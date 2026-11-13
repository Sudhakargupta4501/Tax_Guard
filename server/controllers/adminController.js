'use strict';
const AuditLog = require('../models/AuditLog');
const TaxConfiguration = require('../models/TaxConfiguration');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok, paginate, pageMeta, escapeRegex, dateRange } = require('../utils/helpers');
const { logAudit, diffFields } = require('../utils/audit');
const settings = require('../services/settingsService');

// ---- audit logs (read-only) ----
exports.auditList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const q = req.query;
  const filter = { ...dateRange(q, 'timestamp') };
  if (q.entityType) filter.entityType = q.entityType;
  if (q.action) filter.action = new RegExp(escapeRegex(q.action), 'i');
  if (q.user) filter.user = q.user;
  const [rows, total] = await Promise.all([AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  ok(res, rows, { pagination: pageMeta(page, limit, total) });
});

// ---- tax configuration ----
exports.taxList = asyncHandler(async (req, res) => {
  const filter = req.query.active ? { isActive: req.query.active === 'true' } : {};
  ok(res, await TaxConfiguration.find(filter).sort({ category: 1, effectiveDate: -1 }).lean());
});
exports.taxCreate = asyncHandler(async (req, res) => {
  const cfg = await TaxConfiguration.create({ ...req.body, createdBy: req.user._id });
  await logAudit(req, { action: 'taxconfig.create', entityType: 'TaxConfiguration', entityId: cfg._id, summary: { category: cfg.category, rate: cfg.rate } });
  ok(res, cfg, { message: 'Tax configuration created' }, 201);
});
exports.taxUpdate = asyncHandler(async (req, res) => {
  const cfg = await TaxConfiguration.findById(req.params.id);
  if (!cfg) throw ApiError.notFound('Tax configuration not found');
  const before = cfg.toObject();
  cfg.set({ ...req.body, updatedBy: req.user._id });
  await cfg.save();
  await logAudit(req, { action: 'taxconfig.update', entityType: 'TaxConfiguration', entityId: cfg._id, summary: diffFields(before, cfg.toObject(), ['name', 'rate', 'category', 'effectiveDate', 'isActive']) });
  ok(res, cfg, { message: 'Tax configuration updated' });
});

// ---- users ----
exports.userList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), User.countDocuments(filter)]);
  ok(res, rows.map(({ passwordHash, __v, ...u }) => u), { pagination: pageMeta(page, limit, total) });
});
exports.userUpdate = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  const demotes = (req.body.role && req.body.role !== 'admin' && user.role === 'admin') || req.body.accountStatus === 'disabled';
  if (demotes && user.role === 'admin') {
    const otherAdmins = await User.countDocuments({ role: 'admin', accountStatus: 'active', _id: { $ne: user._id } });
    if (!otherAdmins) throw ApiError.conflict('At least one active administrator must remain');
  }
  const before = user.toObject();
  user.set(req.body);
  await user.save();
  await logAudit(req, { action: 'user.update', entityType: 'User', entityId: user._id, summary: { email: user.email, ...diffFields(before, user.toObject(), ['role', 'accountStatus']) } });
  ok(res, user, { message: 'User updated' });
});

// ---- settings ----
exports.businessGet = asyncHandler(async (_req, res) => ok(res, await settings.getBusinessProfile()));
exports.businessPut = asyncHandler(async (req, res) => {
  const before = await settings.getBusinessProfile();
  const saved = await settings.saveBusinessProfile(req.body, req.user._id);
  await logAudit(req, { action: 'settings.business.update', entityType: 'Setting', entityId: 'business', summary: diffFields(before, { ...before, ...saved }, Object.keys(req.body)) });
  ok(res, await settings.getBusinessProfile(), { message: 'Business profile saved' });
});
exports.thresholdsGet = asyncHandler(async (_req, res) => ok(res, await settings.getThresholds()));
exports.thresholdsPut = asyncHandler(async (req, res) => {
  const before = await settings.getThresholds();
  const after = await settings.saveThresholds(req.body, req.user._id);
  await logAudit(req, { action: 'settings.thresholds.update', entityType: 'Setting', entityId: 'fraudThresholds', summary: diffFields(before, after, Object.keys(req.body)) });
  ok(res, after, { message: 'Fraud thresholds saved. Re-run analysis to apply them to existing records.' });
});
