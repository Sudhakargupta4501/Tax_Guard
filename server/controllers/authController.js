'use strict';
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/helpers');
const { logAudit } = require('../utils/audit');
const { signToken, cookieOptions, csrfTokenFor, COOKIE_NAME, permissionsForRole } = require('../middleware/auth');

// A valid bcrypt hash used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function startSession(res, user) {
  const token = signToken(user);
  const maxAge = parseExpiryMs(env.JWT_EXPIRES_IN);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge });
  return { user, permissions: permissionsForRole(user.role), csrfToken: csrfTokenFor(token) };
}

function parseExpiryMs(v) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(v));
  if (!m) return 24 * 3600 * 1000;
  const n = Number(m[1]);
  return n * { s: 1000, m: 60000, h: 3600000, d: 86400000, '': 1000 }[m[2]];
}

exports.register = asyncHandler(async (req, res) => {
  if (env.ALLOW_PUBLIC_REGISTRATION !== 'true') throw ApiError.forbidden('Public registration is disabled. Ask an administrator for an account.');
  const { name, email, password } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('An account with this email already exists');
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  // Role is never taken from the request: public sign-ups always get the standard "accountant" role.
  const user = await User.create({ name, email, passwordHash, role: 'accountant' });
  req.user = user;
  await logAudit(req, { action: 'user.register', entityType: 'User', entityId: user._id, summary: { email, role: user.role } });
  ok(res, startSession(res, user), { message: 'Account created' }, 201);
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) throw ApiError.unauthorized('Invalid email or password');
  if (user.accountStatus !== 'active') throw ApiError.forbidden('This account has been disabled');
  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  await logAudit(req, { action: 'user.login', entityType: 'User', entityId: user._id });
  ok(res, startSession(res, user), { message: 'Signed in' });
});

exports.me = asyncHandler(async (req, res) => {
  ok(res, { user: req.user, permissions: permissionsForRole(req.user.role), csrfToken: csrfTokenFor(req.authToken) });
});

exports.logout = asyncHandler(async (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions() });
  ok(res, null, { message: 'Signed out' });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+passwordHash');
  const changed = [];
  if (name && name !== user.name) { user.name = name; changed.push('name'); }
  if (newPassword) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw ApiError.badRequest('Current password is incorrect');
    user.passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    changed.push('password');
  }
  await user.save();
  await logAudit(req, { action: 'user.profile.update', entityType: 'User', entityId: user._id, summary: { fields: changed } });
  ok(res, user, { message: 'Profile updated' });
});
