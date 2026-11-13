'use strict';
/**
 * Optional client for the Python (FastAPI + scikit-learn Isolation Forest) service.
 * The core application never depends on it: every failure resolves to { available: false }.
 */
const env = require('../config/env');

async function scoreInvoices(rows) {
  if (!env.ML_SERVICE_URL) return { available: false, reason: 'ML_SERVICE_URL is not configured' };
  try {
    const res = await fetch(`${env.ML_SERVICE_URL.replace(/\/$/, '')}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { available: false, reason: `ML service responded with HTTP ${res.status}` };
    const data = await res.json();
    return { available: true, ...data };
  } catch (err) {
    return { available: false, reason: `ML service unreachable (${err.name})` };
  }
}

async function health() {
  if (!env.ML_SERVICE_URL) return { configured: false, available: false };
  try {
    const res = await fetch(`${env.ML_SERVICE_URL.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
    return { configured: true, available: res.ok };
  } catch {
    return { configured: true, available: false };
  }
}

module.exports = { scoreInvoices, health };
