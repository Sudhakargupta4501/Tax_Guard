'use strict';
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function paginate(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
}

const pageMeta = (page, limit, total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parses ?from=&to= (ISO dates) into a Mongo date range; `to` is inclusive of the whole day. */
function dateRange(query, field = 'invoiceDate') {
  const range = {};
  if (query.from) range.$gte = new Date(query.from);
  if (query.to) {
    const to = new Date(query.to);
    if (!String(query.to).includes('T')) to.setUTCHours(23, 59, 59, 999);
    range.$lte = to;
  }
  return Object.keys(range).length ? { [field]: range } : {};
}

const ok = (res, data, extra = {}, status = 200) => res.status(status).json({ success: true, data, ...extra });

module.exports = { asyncHandler, paginate, pageMeta, escapeRegex, dateRange, ok };
