import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';

const ISSUER = 'toolbox-api';
const ALGORITHM = 'HS256';

/**
 * Short-lived access token. Kept in memory by the SPA and sent as a Bearer header.
 * @param {{ sub: string, aud: 'user'|'vendor'|'admin', role?: string }} claims
 */
export function signAccessToken({ sub, aud, role }) {
  return jwt.sign({ typ: 'access', ...(role ? { role } : {}) }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: String(sub),
    audience: aud,
    issuer: ISSUER,
    expiresIn: env.JWT_ACCESS_TTL,
    jwtid: crypto.randomUUID(),
  });
}

export function verifyAccessToken(token, aud) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM], audience: aud, issuer: ISSUER });
  if (payload.typ !== 'access') throw ApiError.unauthorized('Invalid token', { code: 'TOKEN_INVALID' });
  return payload;
}

/** Access token lifetime in seconds, so the client knows when to refresh proactively. */
export function accessTokenTtlSeconds(token) {
  const { exp, iat } = jwt.decode(token);
  return exp - iat;
}

/**
 * Proof that a phone number passed OTP verification but has no account yet.
 * It can only be exchanged for a new account on the matching audience.
 */
export function signOnboardingToken({ phone, aud }) {
  return jwt.sign({ typ: 'onboarding', phone }, env.JWT_ONBOARDING_SECRET, {
    algorithm: ALGORITHM,
    audience: aud,
    issuer: ISSUER,
    expiresIn: env.JWT_ONBOARDING_TTL,
  });
}

export function verifyOnboardingToken(token, aud) {
  try {
    const payload = jwt.verify(token, env.JWT_ONBOARDING_SECRET, { algorithms: [ALGORITHM], audience: aud, issuer: ISSUER });
    if (payload.typ !== 'onboarding' || !payload.phone) throw new Error('wrong token type');
    return payload;
  } catch {
    throw ApiError.unauthorized('Your verification has expired. Please verify your mobile number again.', {
      code: 'ONBOARDING_TOKEN_INVALID',
    });
  }
}
