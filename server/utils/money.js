'use strict';
/**
 * Decimal-safe money helpers. All arithmetic is performed on integer paise
 * (1 INR = 100 paise) and rounded half-up, so floating point drift never
 * reaches stored totals.
 */

function parseDecimalToScaled(value, scale) {
  // Returns integer = round_half_up(value * 10^scale) using string parsing (no float multiplication).
  if (value === null || value === undefined || value === '') throw new TypeError('Amount is required');
  let str = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value).trim();
  if (/e/i.test(str)) str = Number(str).toFixed(scale + 4);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) throw new TypeError(`Invalid numeric value: ${value}`);
  const neg = Boolean(m[1]);
  const intPart = m[2];
  const frac = (m[3] || '').padEnd(scale + 1, '0');
  let scaled = BigInt(intPart + frac.slice(0, scale));
  if (Number(frac[scale]) >= 5) scaled += 1n; // half-up on magnitude
  const result = Number(scaled);
  return neg ? -result : result;
}

const toPaise = (value) => parseDecimalToScaled(value, 2);
const fromPaise = (paise) => Math.round(paise) / 100;

/** Integer division rounded half-up (magnitude), BigInt-safe. */
function divRound(numerator, denominator) {
  const n = BigInt(Math.round(numerator));
  const d = BigInt(Math.round(denominator));
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return Number(neg ? -q : q);
}

/** Percent (e.g. 18 or 2.5) -> basis points (1800 / 250). */
const percentToBp = (pct) => parseDecimalToScaled(pct, 2);
/** Quantity (up to 3 decimals) -> milli-units. */
const qtyToMilli = (qty) => parseDecimalToScaled(qty, 3);

const formatINR = (rupees) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees);

module.exports = { toPaise, fromPaise, divRound, percentToBp, qtyToMilli, formatINR };
