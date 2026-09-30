import argon2 from 'argon2';
import { createLimiter } from '#core/middlewares/rateLimit.js';
import { ApiError } from '#core/errors/ApiError.js';
import { uniqueSlug } from '#core/utils/strings.js';
import { Admin } from '#modules/admins/admin.model.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { otpService } from '#services/otp/otp.service.js';
import { accessTokenTtlSeconds, signAccessToken, signOnboardingToken, verifyOnboardingToken } from '#services/token/token.service.js';
import { accounts } from './accounts.js';
import { sessionService } from './session.service.js';

// Constant-time-ish response for unknown emails: always run one argon2 verify.
const DUMMY_HASH = await argon2.hash('toolbox-timing-equaliser', { type: argon2.argon2id });

const MAX_ADMIN_FAILURES = 5;
const adminFailures = createLimiter({ keyPrefix: 'admin-login-fail', points: MAX_ADMIN_FAILURES, duration: 15 * 60 });

async function signIn({ audience, account, req, res }) {
  const registry = accounts[audience];
  registry.assertCanSignIn(account);

  await registry.model.updateOne({ _id: account._id }, { lastLoginAt: new Date() });
  await sessionService.start({ subject: account._id, audience, req, res });

  const accessToken = signAccessToken({ sub: account._id, aud: audience, role: account.role });
  return { accessToken, expiresIn: accessTokenTtlSeconds(accessToken), account: registry.serialize(account) };
}

export const authService = {
  sendOtp({ phone, audience }) {
    // Deliberately does not reveal whether the number is registered.
    return otpService.send(audience, phone);
  },

  /**
   * Existing account → signed in. New number → onboarding token the client exchanges on /register.
   */
  async verifyOtp({ phone, otp, audience }, req, res) {
    await otpService.verify(audience, phone, otp);

    const account = await accounts[audience].model.findOne({ phone }).lean();
    if (account) {
      return { status: 'authenticated', ...(await signIn({ audience, account, req, res })) };
    }
    return { status: 'onboarding_required', onboardingToken: signOnboardingToken({ phone, aud: audience }), phone };
  },

  async registerUser({ onboardingToken, name, email, accountType, businessName, gstin }, req, res) {
    const { phone } = verifyOnboardingToken(onboardingToken, 'user');

    const existing = await User.findOne({ phone }).lean();
    if (existing) return signIn({ audience: 'user', account: existing, req, res });

    const user = await User.create({
      phone,
      name,
      email,
      accountType,
      business: accountType === 'business' ? { name: businessName, gstin } : undefined,
    });
    return signIn({ audience: 'user', account: user.toObject(), req, res });
  },

  async registerVendor({ onboardingToken, contactName, email, storeName }, req, res) {
    const { phone } = verifyOnboardingToken(onboardingToken, 'vendor');

    const existing = await Vendor.findOne({ phone }).lean();
    if (existing) return signIn({ audience: 'vendor', account: existing, req, res });

    const vendor = await Vendor.create({
      phone,
      contactName,
      email,
      status: 'onboarding',
      store: { name: storeName, slug: await uniqueSlug(Vendor, storeName, { field: 'store.slug' }) },
    });
    return signIn({ audience: 'vendor', account: vendor.toObject(), req, res });
  },

  async adminLogin({ email, password }, req, res) {
    const lockKey = email;
    const state = await adminFailures.get(lockKey);
    if (state && state.consumedPoints >= MAX_ADMIN_FAILURES) {
      throw ApiError.tooManyRequests('Too many failed attempts. Please try again later.', {
        code: 'LOGIN_LOCKED',
        details: { retryAfter: Math.ceil(state.msBeforeNext / 1000) },
      });
    }

    const admin = await Admin.findOne({ email }).select('+passwordHash').lean();
    const valid = await argon2.verify(admin?.passwordHash ?? DUMMY_HASH, password);

    if (!admin || !valid) {
      await adminFailures.consume(lockKey).catch(() => {});
      throw ApiError.unauthorized('Incorrect email or password', { code: 'INVALID_CREDENTIALS' });
    }

    await adminFailures.delete(lockKey);
    const { passwordHash: _omit, ...safeAdmin } = admin;
    return signIn({ audience: 'admin', account: safeAdmin, req, res });
  },

  async refresh(audience, req, res) {
    const { subject } = await sessionService.rotate({ audience, req, res });
    const registry = accounts[audience];
    const account = await registry.model.findById(subject).lean();
    if (!account) throw ApiError.unauthorized('Account not found', { code: 'ACCOUNT_NOT_FOUND' });
    registry.assertCanSignIn(account);

    const accessToken = signAccessToken({ sub: account._id, aud: audience, role: account.role });
    return { accessToken, expiresIn: accessTokenTtlSeconds(accessToken), account: registry.serialize(account) };
  },

  logout(audience, req, res) {
    return sessionService.end({ audience, req, res });
  },
};

export async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}
