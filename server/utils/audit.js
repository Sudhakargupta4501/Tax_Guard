'use strict';
const AuditLog = require('../models/AuditLog');

const SENSITIVE_KEY = /pass(word)?|token|secret|hash|authorization/i;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return String(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Records changed fields as {field: {from, to}}. */
function diffFields(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const a = before[f];
    const b = after[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[f] = { from: a, to: b };
  }
  return changes;
}

/** Best-effort append-only audit write. Never logs passwords or tokens. */
async function logAudit(req, { action, entityType, entityId, summary }) {
  try {
    await AuditLog.create({
      user: req?.user?._id,
      userName: req?.user?.name,
      action,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
      summary: sanitize(summary),
      ip: req?.ip,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit, diffFields, sanitize };
