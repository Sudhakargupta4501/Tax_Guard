'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, request, startDb, stopDb, login, createUser, PASSWORD } = require('../helpers/app');
const User = require('../../models/User');

test.before(startDb);
test.after(stopDb);

test('registration validates input, hides password hash and never grants admin', async () => {
  const bad = await request(app).post('/api/auth/register').send({ name: 'A', email: 'nope', password: 'weak' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.length >= 2);

  const res = await request(app).post('/api/auth/register').send({ name: 'New Person', email: 'New@Example.test', password: 'Valid-Passw0rd', role: 'admin' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, 'accountant'); // role in the body is ignored (mass-assignment protection)
  assert.equal(res.body.data.user.email, 'new@example.test');
  assert.equal(res.body.data.user.passwordHash, undefined);
  assert.match(String(res.headers['set-cookie']), /HttpOnly/i);

  const dup = await request(app).post('/api/auth/register').send({ name: 'New Person', email: 'new@example.test', password: 'Valid-Passw0rd' });
  assert.equal(dup.status, 409);
});

test('login succeeds with correct credentials and fails generically otherwise', async () => {
  const user = await createUser('accountant');
  const ok = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.csrfToken);
  assert.ok(ok.body.data.permissions.includes('invoice:write'));

  const wrongPw = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Wrong-Passw0rd' });
  const noUser = await request(app).post('/api/auth/login').send({ email: 'ghost@example.test', password: 'Wrong-Passw0rd' });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.body.message, noUser.body.message); // no user enumeration
});

test('authentication middleware rejects missing, malformed and CSRF-less requests', async () => {
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/customers')).status, 401);
  assert.equal((await request(app).get('/api/customers').set('Authorization', 'Bearer not-a-token')).status, 401);

  const c = await login('accountant');
  assert.equal((await c.get('/api/auth/me')).status, 200);
  // cookie session but no CSRF header on a state-changing request
  const noCsrf = await c.agent.post('/api/customers').send({ name: 'No Csrf', stateCode: '03' });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, 'CSRF');
});

test('logout clears the session cookie', async () => {
  const c = await login('accountant');
  const out = await c.post('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await c.agent.get('/api/auth/me')).status, 401);
});

test('role-based authorization is enforced on the backend', async () => {
  const reviewer = await login('reviewer');
  const accountant = await login('accountant');
  const admin = await login('admin');

  assert.equal((await reviewer.post('/api/customers', { name: 'Blocked Co', stateCode: '03' })).status, 403);
  assert.equal((await accountant.get('/api/users')).status, 403);
  assert.equal((await accountant.put('/api/settings/business', { name: 'X Co', stateCode: '03' })).status, 403);
  assert.equal((await accountant.post('/api/tax-config', { name: 'Hack', rate: 0, category: 'HACK' })).status, 403);
  assert.equal((await admin.get('/api/users')).status, 200);

  // privilege escalation via profile update is impossible: role is not an accepted field
  const me = await accountant.patch('/api/auth/me', { name: 'Renamed Person', role: 'admin' });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.role, 'accountant');
});

test('admin role changes are audited; the last admin cannot be demoted; invalid ids are rejected', async () => {
  const admin = await login('admin');
  const target = await createUser('accountant');
  const upd = await admin.patch(`/api/users/${target._id}`, { role: 'reviewer' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.role, 'reviewer');
  const logs = await admin.get('/api/audit-logs?action=user.update');
  assert.ok(logs.body.data.some((l) => l.entityId === String(target._id)));
  assert.equal((await admin.patch('/api/users/not-an-id', { role: 'reviewer' })).status, 400);
  // make this admin the only active one, then try to demote them
  await User.updateMany({ role: 'admin', _id: { $ne: admin.user._id } }, { accountStatus: 'disabled' });
  assert.equal((await admin.patch(`/api/users/${admin.user._id}`, { role: 'reviewer' })).status, 409);
});
