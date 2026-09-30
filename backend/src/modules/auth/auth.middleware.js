import { ApiError } from '#core/errors/ApiError.js';
import { verifyAccessToken } from '#services/token/token.service.js';
import { accounts } from './accounts.js';

function bearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Verifies the access token for `audience` and loads the account on every request,
 * so blocks/suspensions apply immediately rather than when the token expires.
 * Sets req.auth = { audience, id, role } and req.account (lean document).
 */
export function authenticate(audience, { optional = false } = {}) {
  const registry = accounts[audience];
  return async (req, _res, next) => {
    const token = bearer(req);
    if (!token) {
      if (optional) return next();
      throw ApiError.unauthorized('Authentication required', { code: 'NO_TOKEN' });
    }

    const payload = verifyAccessToken(token, audience);
    const account = await registry.model.findById(payload.sub).lean();
    if (!account) throw ApiError.unauthorized('Account not found', { code: 'ACCOUNT_NOT_FOUND' });
    registry.assertCanSignIn(account);

    req.auth = { audience, id: account._id, role: account.role };
    req.account = account;
    next();
  };
}

export function requireAdminRole(...roles) {
  return (req, _res, next) => {
    if (req.auth?.audience !== 'admin' || !roles.includes(req.account.role)) {
      throw ApiError.forbidden('Only a super admin can do this', { code: 'INSUFFICIENT_ROLE' });
    }
    next();
  };
}

export function requireApprovedVendor(req, _res, next) {
  if (req.account?.status !== 'approved') {
    throw ApiError.forbidden('Your store needs to be approved before you can do this.', { code: 'VENDOR_NOT_APPROVED' });
  }
  next();
}

/** Actor stamp for audit fields. */
export const actorOf = (req) => ({ kind: req.auth.audience, id: req.auth.id });
