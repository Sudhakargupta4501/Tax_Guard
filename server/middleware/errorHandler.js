'use strict';
const { ZodError } = require('zod');
const mongoose = require('mongoose');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Internal server error';
  let errors;
  let code = err.code && typeof err.code === 'string' ? err.code : undefined;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    errors = err.errors;
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    errors = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid value for ${err.path}`;
  } else if (err && err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    message = `Duplicate value: a record with this ${field} already exists`;
    code = 'DUPLICATE';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  } else if (err.message === 'Not allowed by CORS') {
    status = 403;
    message = 'Origin not allowed';
  } else if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError') {
    status = 503;
    message = 'Database temporarily unavailable. Please try again.';
  } else if (err.message === 'Audit log records are immutable') {
    status = 403;
    message = err.message;
  }

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, env.isProd ? err.message : err.stack);
    if (!env.isProd && err.message) message = err.message; // expose detail only outside production
  }

  const body = { success: false, message };
  if (errors) body.errors = errors;
  if (code) body.code = code;
  res.status(status).json(body);
}

module.exports = { errorHandler, notFoundHandler };
