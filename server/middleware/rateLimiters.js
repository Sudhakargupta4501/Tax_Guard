'use strict';
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const make = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.DISABLE_RATE_LIMIT === 'true' || env.NODE_ENV === 'test',
    handler: (_req, res) => res.status(429).json({ success: false, message, code: 'RATE_LIMITED' }),
  });

module.exports = {
  authLimiter: make(15 * 60 * 1000, 20, 'Too many authentication attempts. Please try again in 15 minutes.'),
  sensitiveLimiter: make(15 * 60 * 1000, 60, 'Too many requests for this operation. Please slow down.'),
  apiLimiter: make(15 * 60 * 1000, 1500, 'Too many requests. Please try again later.'),
};
