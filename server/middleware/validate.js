'use strict';
/**
 * Validates and sanitises params/query/body with Zod. Unknown keys are stripped,
 * which also prevents mass-assignment (e.g. a client cannot send `role` or `createdBy`).
 */
module.exports = (schemas) => (req, _res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) req.query = schemas.query.parse(req.query);
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  } catch (err) {
    next(err);
  }
};
