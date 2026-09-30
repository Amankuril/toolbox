import mongoose from 'mongoose';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env } from '#config/env.js';
import { ApiError } from './ApiError.js';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Express recognises error middleware by arity, so all four params must stay.
export function errorHandler(err, req, res, _next) {
  const apiError = normalize(err);

  if (apiError.statusCode >= 500) {
    req.log?.error({ err }, 'Unhandled error');
  } else {
    req.log?.debug({ err: { message: err.message, code: apiError.code } }, 'Request failed');
  }

  const body = {
    success: false,
    error: {
      code: apiError.code,
      message: apiError.statusCode >= 500 && env.isProduction ? 'Something went wrong' : apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      requestId: req.id,
    },
  };

  if (apiError.statusCode === 429 && apiError.details?.retryAfter) {
    res.setHeader('Retry-After', String(apiError.details.retryAfter));
  }
  res.status(apiError.statusCode).json(body);
}

function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.unprocessable('Validation failed', { details: formatZodIssues(err) });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return ApiError.unprocessable('Validation failed', { details });
  }

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for ${err.path}`);
  }

  if (err?.code === 11000) {
    const fields = Object.keys(err.keyValue ?? err.keyPattern ?? {});
    return ApiError.conflict(`${fields.join(', ') || 'Value'} already exists`, {
      code: 'DUPLICATE',
      details: fields.map((path) => ({ path, message: 'Already exists' })),
    });
  }

  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return new ApiError(status, uploadMessage(err), { code: err.code });
  }

  if (err instanceof jwt.TokenExpiredError) {
    return ApiError.unauthorized('Session expired', { code: 'TOKEN_EXPIRED' });
  }
  if (err instanceof jwt.JsonWebTokenError) {
    return ApiError.unauthorized('Invalid token', { code: 'TOKEN_INVALID' });
  }

  // Malformed JSON from express.json()
  if (err?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON body');
  }
  if (err?.type === 'entity.too.large') {
    return new ApiError(413, 'Request body too large');
  }

  return new ApiError(500, err?.message || 'Internal server error', { code: 'INTERNAL_ERROR' });
}

export function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    // Drop the leading body/query/params segment added by the validate middleware.
    path: issue.path.slice(['body', 'query', 'params'].includes(issue.path[0]) ? 1 : 0).join('.'),
    message: issue.message,
  }));
}

function uploadMessage(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return `Each file must be smaller than ${env.UPLOAD_MAX_FILE_SIZE_MB} MB`;
    case 'LIMIT_FILE_COUNT':
      return `You can upload up to ${env.UPLOAD_MAX_FILES} files at once`;
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Unexpected file field';
    default:
      return err.message;
  }
}
