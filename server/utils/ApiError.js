'use strict';
class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.expose = true;
  }
  static badRequest(msg, errors) { return new ApiError(400, msg, errors); }
  static unauthorized(msg = 'Authentication required') { return new ApiError(401, msg); }
  static forbidden(msg = 'You do not have permission to perform this action') { return new ApiError(403, msg); }
  static notFound(msg = 'Resource not found') { return new ApiError(404, msg); }
  static conflict(msg) { return new ApiError(409, msg); }
  static unprocessable(msg, errors) { return new ApiError(422, msg, errors); }
}
module.exports = ApiError;
