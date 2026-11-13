'use strict';
require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (MongoDB Atlas connection string)'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  BUSINESS_NAME: z.string().default('Demo Business'),
  BUSINESS_GSTIN: z.string().default(''),
  BUSINESS_STATE_CODE: z.string().regex(/^\d{2}$/, 'BUSINESS_STATE_CODE must be a 2-digit GST state code').default('03'),
  BUSINESS_ADDRESS: z.string().default(''),
  DEFAULT_CURRENCY: z.string().default('INR'),
  REPORT_TIMEZONE: z.string().default('Asia/Kolkata'),
  ML_SERVICE_URL: z.string().optional().default(''),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  ALLOW_PUBLIC_REGISTRATION: z.enum(['true', 'false']).default('true'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  DISABLE_RATE_LIMIT: z.enum(['true', 'false']).default('false'),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}\nCopy server/.env.example to server/.env and fill in the values.`);
  }
  const env = parsed.data;
  env.isProd = env.NODE_ENV === 'production';
  env.cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.isProd;
  env.clientOrigins = env.CLIENT_URL.split(',').map((s) => s.trim()).filter(Boolean);
  return env;
}

module.exports = loadEnv();
