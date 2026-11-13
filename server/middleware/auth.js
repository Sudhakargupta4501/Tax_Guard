'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler } = require('../utils/helpers');

const COOKIE_NAME = 'tg_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Role -> permission map. The backend is the source of truth; the React app only mirrors it for UX.
 */
const ALL = ['admin', 'business_owner', 'accountant', 'reviewer'];
const STAFF_WRITE = ['admin', 'business_owner', 'accountant'];
const PERMISSIONS = {
  'customer:read': ALL,
  'customer:write': STAFF_WRITE,
  'customer:delete': ['admin', 'business_owner'],
  'product:read': ALL,
  'product:write': STAFF_WRITE,
  'product:delete': ['admin', 'business_owner'],
  'invoice:read': ALL,
  'invoice:write': STAFF_WRITE,
  'invoice:cancel': ['admin', 'business_owner'],
  'payment:read': ALL,
  'payment:write': STAFF_WRITE,
  'fraud:read': ALL,
  'fraud:analyze': ['admin', 'business_owner', 'reviewer'],
  'fraud:review': ['admin', 'reviewer'],
  'transactions:import': STAFF_WRITE,
  'report:read': ALL,
  'audit:read': ['admin', 'business_owner', 'reviewer'],
  'taxconfig:read': ALL,
  'taxconfig:write': ['admin'],
  'settings:read': ALL,
  'settings:write': ['admin'],
  'user:manage': ['admin'],
};

const csrfTokenFor = (jwtString) =>
  crypto.createHmac('sha256', env.JWT_SECRET).update(jwtString).digest('hex').slice(0, 48);

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function cookieOptions() {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: env.COOKIE_SAMESITE, path: '/' };
}

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return { token: req.cookies[COOKIE_NAME], via: 'cookie' };
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return { token: header.slice(7), via: 'bearer' };
  return null;
}

const authenticate = asyncHandler(async (req, _res, next) => {
  const found = extractToken(req);
  if (!found) throw ApiError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(found.token, env.JWT_SECRET);
  } catch (err) {
    const e = ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Invalid authentication token');
    e.code = err.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'INVALID_TOKEN';
    throw e;
  }

  // CSRF protection for cookie-authenticated, state-changing requests.
  if (found.via === 'cookie' && !SAFE_METHODS.has(req.method)) {
    const supplied = String(req.headers['x-csrf-token'] || '');
    const expected = csrfTokenFor(found.token);
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const e = ApiError.forbidden('Invalid or missing CSRF token');
      e.code = 'CSRF';
      throw e;
    }
  }

  const user = await User.findById(payload.sub);
  if (!user || user.accountStatus !== 'active') throw ApiError.unauthorized('Account not found or disabled');

  req.user = user;
  req.authToken = found.token;
  req.authVia = found.via;
  next();
});

const authorize = (permission) => {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission: ${permission}`);
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) return next(ApiError.forbidden());
    return next();
  };
};

const permissionsForRole = (role) => Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));

module.exports = { authenticate, authorize, signToken, cookieOptions, csrfTokenFor, COOKIE_NAME, PERMISSIONS, permissionsForRole };
