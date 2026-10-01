import crypto from 'node:crypto';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';
import { randomToken, sha256 } from '#core/utils/crypto.js';
import { refreshCookieName, refreshCookiePath } from './auth.constants.js';
import { Session } from './session.model.js';

// A rotated token presented again within this window is treated as a benign race
// (two tabs refreshing at once) rather than theft.
const ROTATION_GRACE_MS = 30_000;

const ttlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

function cookieOptions(audience, expires) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: refreshCookiePath(audience),
    domain: env.COOKIE_DOMAIN || undefined,
    ...(expires ? { expires } : {}),
  };
}

function setCookie(res, audience, token, expires) {
  res.cookie(refreshCookieName(audience), token, cookieOptions(audience, expires));
}

export function clearRefreshCookie(res, audience) {
  res.clearCookie(refreshCookieName(audience), cookieOptions(audience));
}

function clientMeta(req) {
  return { userAgent: req.get('user-agent')?.slice(0, 400), ip: req.ip };
}

async function createSession({ subject, audience, family, req }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  await Session.create({ subject, audience, tokenHash: sha256(token), family, expiresAt, ...clientMeta(req) });
  return { token, expiresAt };
}

export const sessionService = {
  /** Starts a new session family and sets the refresh cookie. */
  async start({ subject, audience, req, res }) {
    const { token, expiresAt } = await createSession({ subject, audience, family: crypto.randomUUID(), req });
    setCookie(res, audience, token, expiresAt);
  },

  /**
   * Validates the refresh cookie, rotates it and returns the session subject.
   * Reuse of an already-rotated token (outside the grace window) revokes the whole family.
   */
  async rotate({ audience, req, res }) {
    const token = req.cookies?.[refreshCookieName(audience)];
    if (!token) throw ApiError.unauthorized('Not signed in', { code: 'NO_SESSION' });

    const session = await Session.findOne({ tokenHash: sha256(token), audience }).lean();
    if (!session || session.expiresAt < new Date()) {
      clearRefreshCookie(res, audience);
      throw ApiError.unauthorized('Session expired. Please sign in again.', { code: 'SESSION_EXPIRED' });
    }

    if (session.revokedAt) {
      const withinGrace = session.revokedReason === 'rotated' && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace) {
        await Session.updateMany({ family: session.family, revokedAt: null }, { revokedAt: new Date(), revokedReason: 'reuse_detected' });
        clearRefreshCookie(res, audience);
      }
      throw ApiError.unauthorized('Session is no longer valid. Please sign in again.', {
        code: withinGrace ? 'SESSION_ROTATED' : 'SESSION_REVOKED',
      });
    }

    // Conditional update makes concurrent rotations of the same token safe: only one wins.
    const claimed = await Session.findOneAndUpdate(
      { _id: session._id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'rotated' },
    );
    if (!claimed) throw ApiError.unauthorized('Session is no longer valid.', { code: 'SESSION_ROTATED' });

    const next = await createSession({ subject: session.subject, audience, family: session.family, req });
    setCookie(res, audience, next.token, next.expiresAt);
    return { subject: session.subject };
  },

  async end({ audience, req, res }) {
    const token = req.cookies?.[refreshCookieName(audience)];
    if (token) {
      await Session.updateOne({ tokenHash: sha256(token), audience, revokedAt: null }, { revokedAt: new Date(), revokedReason: 'logout' });
    }
    clearRefreshCookie(res, audience);
  },

  /** Sign an account out everywhere (password change, suspension, admin action). */
  async revokeAll(subject, audience, reason = 'admin') {
    await Session.updateMany({ subject, audience, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
  },
};
