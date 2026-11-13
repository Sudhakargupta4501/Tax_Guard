'use strict';
const express = require('express');
const v = require('../validators/schemas');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { authLimiter, sensitiveLimiter } = require('../middleware/rateLimiters');
const auth = require('../controllers/authController');
const customers = require('../controllers/customerController');
const products = require('../controllers/productController');
const invoices = require('../controllers/invoiceController');
const payments = require('../controllers/paymentController');
const fraud = require('../controllers/fraudController');
const reports = require('../controllers/reportController');
const admin = require('../controllers/adminController');

const router = express.Router();
const id = { params: v.idParams };

// ---------- Authentication ----------
const authRouter = express.Router();
authRouter.post('/register', authLimiter, validate({ body: v.register }), auth.register);
authRouter.post('/login', authLimiter, validate({ body: v.login }), auth.login);
authRouter.post('/logout', auth.logout);
authRouter.get('/me', authenticate, auth.me);
authRouter.patch('/me', authenticate, validate({ body: v.profileUpdate }), auth.updateProfile);
router.use('/auth', authRouter);

// Everything below requires an authenticated session.
router.use(authenticate);

// ---------- Customers ----------
const c = express.Router();
c.get('/', authorize('customer:read'), validate({ query: v.customerQuery }), customers.list);
c.post('/', authorize('customer:write'), validate({ body: v.customerBody }), customers.create);
c.get('/:id', authorize('customer:read'), validate(id), customers.get);
c.put('/:id', authorize('customer:write'), validate({ ...id, body: v.customerBody }), customers.update);
c.delete('/:id', authorize('customer:delete'), validate(id), customers.remove);
router.use('/customers', c);

// ---------- Products ----------
const p = express.Router();
p.get('/', authorize('product:read'), validate({ query: v.productQuery }), products.list);
p.post('/', authorize('product:write'), validate({ body: v.productBody }), products.create);
p.get('/:id', authorize('product:read'), validate(id), products.get);
p.put('/:id', authorize('product:write'), validate({ ...id, body: v.productBody }), products.update);
p.delete('/:id', authorize('product:delete'), validate(id), products.remove);
router.use('/products', p);

// ---------- Invoices ----------
const i = express.Router();
i.get('/', authorize('invoice:read'), validate({ query: v.invoiceQuery }), invoices.list);
i.post('/', authorize('invoice:write'), sensitiveLimiter, validate({ body: v.invoiceCreate }), invoices.create);
i.get('/:id', authorize('invoice:read'), validate(id), invoices.get);
i.put('/:id', authorize('invoice:write'), validate({ ...id, body: v.invoiceUpdate }), invoices.update);
i.get('/:id/pdf', authorize('invoice:read'), validate(id), invoices.pdf);
router.use('/invoices', i);

// ---------- Payments (append-only: no update/delete routes) ----------
const pay = express.Router();
pay.get('/', authorize('payment:read'), validate({ query: v.paymentQuery }), payments.list);
pay.post('/', authorize('payment:write'), sensitiveLimiter, validate({ body: v.paymentBody }), payments.create);
pay.get('/:id', authorize('payment:read'), validate(id), payments.get);
router.use('/payments', pay);

// ---------- Fraud detection ----------
const f = express.Router();
f.get('/', authorize('fraud:read'), validate({ query: v.fraudQuery }), fraud.list);
f.get('/meta', authorize('fraud:read'), fraud.meta);
f.post('/analyze', authorize('fraud:analyze'), sensitiveLimiter, validate({ body: v.analyzeBody }), fraud.analyze);
f.get('/transactions', authorize('fraud:read'), validate({ query: v.userQuery }), fraud.listTransactions);
f.post('/transactions', authorize('transactions:import'), validate({ body: v.transactionImport }), fraud.importTransactions);
f.get('/:id', authorize('fraud:read'), validate(id), fraud.get);
f.patch('/:id/review', authorize('fraud:review'), validate({ ...id, body: v.reviewBody }), fraud.review);
router.use('/fraud-alerts', f);

// ---------- Reports ----------
const r = express.Router();
r.get('/summary', authorize('report:read'), validate({ query: v.rangeQuery }), reports.summary);
r.get('/sales', authorize('report:read'), validate({ query: v.rangeQuery }), reports.sales);
r.get('/tax', authorize('report:read'), validate({ query: v.rangeQuery }), reports.tax);
r.get('/fraud', authorize('report:read'), validate({ query: v.rangeQuery }), reports.fraud);
router.use('/reports', r);

// ---------- Audit logs (read-only) ----------
router.get('/audit-logs', authorize('audit:read'), validate({ query: v.auditQuery }), admin.auditList);

// ---------- Tax configuration ----------
const t = express.Router();
t.get('/', authorize('taxconfig:read'), validate({ query: v.taxConfigQuery }), admin.taxList);
t.post('/', authorize('taxconfig:write'), validate({ body: v.taxConfigBody }), admin.taxCreate);
t.put('/:id', authorize('taxconfig:write'), validate({ ...id, body: v.taxConfigUpdate }), admin.taxUpdate);
router.use('/tax-config', t);

// ---------- Users ----------
const u = express.Router();
u.get('/', authorize('user:manage'), validate({ query: v.userQuery }), admin.userList);
u.patch('/:id', authorize('user:manage'), validate({ ...id, body: v.userUpdate }), admin.userUpdate);
router.use('/users', u);

// ---------- Settings ----------
const s = express.Router();
s.get('/business', authorize('settings:read'), admin.businessGet);
s.put('/business', authorize('settings:write'), validate({ body: v.businessProfile }), admin.businessPut);
s.get('/fraud-thresholds', authorize('settings:read'), admin.thresholdsGet);
s.put('/fraud-thresholds', authorize('settings:write'), validate({ body: v.thresholds }), admin.thresholdsPut);
router.use('/settings', s);

module.exports = router;
