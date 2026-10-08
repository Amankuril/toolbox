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
const DUMMY_HASH = await argon2.hash('toolshubs-timing-equaliser', { type: argon2.argon2id });

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

/** Email sign-in: refuses emails shared by more than one account (possible for older sellers). */
async function findByEmail(audience, email) {
  const matches = await accounts[audience].model.find({ email }).limit(2).lean();
  if (matches.length > 1) {
    throw ApiError.conflict('This email is linked to more than one account. Please sign in with your mobile number.', {
      code: 'EMAIL_AMBIGUOUS',
    });
  }
  return matches[0] ?? null;
}

export const authService = {
  sendOtp({ phone, email, audience }) {
    // Deliberately does not reveal whether the number / email is registered.
    return otpService.send(audience, phone ?? email);
  },

  /**
   * Existing account → signed in. New number / email → onboarding token the client exchanges on
   * /register. Sellers must register with a mobile number (couriers and pickups need one).
   */
  async verifyOtp({ phone, email, otp, audience }, req, res) {
    await otpService.verify(audience, phone ?? email, otp);

    const account = phone ? await accounts[audience].model.findOne({ phone }).lean() : await findByEmail(audience, email);
    if (account) {
      if (email && !account.emailVerifiedAt) {
        // The code just proved they own this inbox.
        await accounts[audience].model.updateOne({ _id: account._id }, { emailVerifiedAt: new Date() });
        account.emailVerifiedAt = new Date();
      }
      return { status: 'authenticated', ...(await signIn({ audience, account, req, res })) };
    }
    if (email && audience === 'vendor') {
      throw ApiError.notFound('No seller account uses this email. Sign up with your mobile number, then you can sign in with either.', {
        code: 'SELLER_EMAIL_NOT_FOUND',
      });
    }
    return {
      status: 'onboarding_required',
      onboardingToken: signOnboardingToken(phone ? { phone, aud: audience } : { email, aud: audience }),
      ...(phone ? { phone } : { email }),
    };
  },

  async registerUser({ onboardingToken, name, email, accountType, businessName, gstin }, req, res) {
    const verified = verifyOnboardingToken(onboardingToken, 'user');

    const existing = verified.phone
      ? await User.findOne({ phone: verified.phone }).lean()
      : await User.findOne({ email: verified.email }).lean();
    if (existing) return signIn({ audience: 'user', account: existing, req, res });

    // Signing up by email: that verified email wins over anything typed in the form.
    const accountEmail = verified.email ?? email;
    try {
      const user = await User.create({
        phone: verified.phone,
        name,
        email: accountEmail,
        emailVerifiedAt: verified.email ? new Date() : undefined,
        accountType,
        business: accountType === 'business' ? { name: businessName, gstin } : undefined,
      });
      return signIn({ audience: 'user', account: user.toObject(), req, res });
    } catch (err) {
      if (err?.code === 11000 && err.keyPattern?.email) {
        throw ApiError.conflict('This email is already used by another account', {
          details: [{ path: 'email', message: 'Already in use' }],
        });
      }
      throw err;
    }
  },

  async registerVendor({ onboardingToken, contactName, email, storeName }, req, res) {
    const { phone } = verifyOnboardingToken(onboardingToken, 'vendor');
    if (!phone) throw ApiError.unprocessable('Sellers sign up with a mobile number', { code: 'PHONE_REQUIRED' });

    const existing = await Vendor.findOne({ phone }).lean();
    if (existing) return signIn({ audience: 'vendor', account: existing, req, res });
    if (await Vendor.exists({ email })) {
      throw ApiError.conflict('This email is already used by another seller account', {
        details: [{ path: 'email', message: 'Already in use' }],
      });
    }

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
    // Each attempt reserves a point before the password is checked (and gets it back on success),
    // so parallel guesses can't all get past the lockout before the first failure is counted.
    try {
      await adminFailures.consume(lockKey);
    } catch (rejection) {
      if (rejection instanceof Error) throw rejection;
      throw ApiError.tooManyRequests('Too many failed attempts. Please try again later.', {
        code: 'LOGIN_LOCKED',
        details: { retryAfter: Math.ceil(rejection.msBeforeNext / 1000) },
      });
    }

    const admin = await Admin.findOne({ email }).select('+passwordHash').lean();
    const valid = await argon2.verify(admin?.passwordHash ?? DUMMY_HASH, password);

    if (!admin || !valid) {
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
