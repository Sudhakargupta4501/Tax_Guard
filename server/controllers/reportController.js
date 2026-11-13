'use strict';
const { asyncHandler, ok } = require('../utils/helpers');
const reports = require('../services/reportService');
const { logAudit } = require('../utils/audit');

exports.summary = asyncHandler(async (req, res) => ok(res, await reports.summary(req.query)));
exports.sales = asyncHandler(async (req, res) => ok(res, await reports.sales(req.query)));
exports.fraud = asyncHandler(async (req, res) => ok(res, await reports.fraud(req.query)));

exports.tax = asyncHandler(async (req, res) => {
  const data = await reports.tax(req.query);
  if (req.query.format !== 'csv') return ok(res, data);
  const csv = reports.toCsv(data.byRate, [
    { key: 'category', label: 'Tax category' }, { key: 'rate', label: 'Rate %' }, { key: 'taxable', label: 'Taxable value' },
    { key: 'cgst', label: 'CGST' }, { key: 'sgst', label: 'SGST' }, { key: 'igst', label: 'IGST' }, { key: 'tax', label: 'Total recorded tax' },
  ]) + '\n\n' + reports.toCsv(data.monthly, [
    { key: 'month', label: 'Month' }, { key: 'taxable', label: 'Taxable value' }, { key: 'cgst', label: 'CGST' },
    { key: 'sgst', label: 'SGST' }, { key: 'igst', label: 'IGST' }, { key: 'tax', label: 'Total recorded tax' },
  ]) + `\n\n"${data.notice}"`;
  await logAudit(req, { action: 'report.export', entityType: 'Report', summary: { type: 'tax', from: req.query.from, to: req.query.to } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tax-report.csv"');
  return res.send(csv);
});
