'use strict';
// Test bootstrap: MUST be required before anything that loads config/env.
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/never-used-in-tests', // real connection URI is supplied by startDb()
  JWT_SECRET: 'test-secret-for-automated-tests-only-0123456789',
  BUSINESS_STATE_CODE: '03',
  BCRYPT_ROUNDS: '4',
  DISABLE_RATE_LIMIT: 'true',
  ALLOW_PUBLIC_REGISTRATION: 'true',
  ML_SERVICE_URL: '',
});

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../app');
const User = require('../../models/User');
const Customer = require('../../models/Customer');
const Product = require('../../models/Product');
const { ensureDefaultTaxConfigs } = require('../../scripts/defaultTax');

let mem;

/** Uses TEST_MONGODB_URI when provided (a throw-away database!), otherwise an in-memory MongoDB. */
async function startDb() {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mem = await MongoMemoryServer.create();
    uri = mem.getUri('taxguard_test');
  }
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}

async function stopDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  if (mem) await mem.stop();
}

const PASSWORD = 'Test-Passw0rd';
let n = 0;

async function createUser(role) {
  n += 1;
  return User.create({ name: `Test ${role} ${n}`, email: `${role}${n}@example.test`, role, passwordHash: await bcrypt.hash(PASSWORD, 4) });
}

/** Signs in through the real login endpoint (cookie session + CSRF header, exactly like the browser). */
async function login(role) {
  const user = await createUser(role);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.data.csrfToken;
  const wrap = (method) => (url, body) => {
    let r = agent[method](url);
    if (method !== 'get') r = r.set('X-CSRF-Token', csrf);
    return body === undefined ? r : r.send(body);
  };
  return { user, agent, get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

async function seedBasics(owner) {
  await ensureDefaultTaxConfigs(owner._id);
  const customerLocal = await Customer.create({ name: 'Local Buyer', email: 'local@example.test', stateCode: '03', createdBy: owner._id, address: { line1: '1 Test Rd', city: 'Ludhiana' } });
  const customerOther = await Customer.create({ name: 'Other-State Buyer', email: 'other@example.test', stateCode: '07', createdBy: owner._id, address: { line1: '2 Test Rd', city: 'Delhi' } });
  const widget = await Product.create({ name: 'Widget', sku: 'WGT-1', unitPrice: 1000, taxCategory: 'GST-18', taxRate: 18, createdBy: owner._id });
  return { customerLocal, customerOther, widget };
}

module.exports = { app, request, startDb, stopDb, createUser, login, seedBasics, PASSWORD };
