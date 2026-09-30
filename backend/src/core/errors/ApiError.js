/**
 * Operational error that is safe to expose to API clients.
 * Anything that is not an ApiError is treated as an unexpected 500.
 */
export class ApiError extends Error {
  constructor(statusCode, message, { code, details, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCode(statusCode);
    this.details = details;
  }

  static badRequest(message = 'Bad request', opts) {
    return new ApiError(400, message, opts);
  }

  static unauthorized(message = 'Authentication required', opts) {
    return new ApiError(401, message, opts);
  }

  static forbidden(message = 'You do not have permission to do this', opts) {
    return new ApiError(403, message, opts);
  }

  static notFound(message = 'Resource not found', opts) {
    return new ApiError(404, message, opts);
  }

  static conflict(message = 'Resource already exists', opts) {
    return new ApiError(409, message, opts);
  }

  static unprocessable(message = 'Validation failed', opts) {
    return new ApiError(422, message, opts);
  }

  static tooManyRequests(message = 'Too many requests, please try again later', opts) {
    return new ApiError(429, message, opts);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable', opts) {
    return new ApiError(503, message, opts);
  }
}

function defaultCode(status) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      422: 'VALIDATION_ERROR',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    }[status] ?? 'INTERNAL_ERROR'
  );
}
