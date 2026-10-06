import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex } from '#core/utils/strings.js';
import { sessionService } from '#modules/auth/session.service.js';
import { User } from './user.model.js';
import { serializeUser } from './user.serializer.js';
import { MAX_ADDRESSES } from './user.validation.js';

async function load(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');
  return user;
}

function ensureSingleDefault(user, preferredId) {
  if (!user.addresses.length) return;
  const target = preferredId ?? user.addresses.find((a) => a.isDefault)?._id ?? user.addresses[0]._id;
  for (const a of user.addresses) a.isDefault = String(a._id) === String(target);
}

export const userService = {
  async me(userId) {
    return serializeUser((await load(userId)).toObject());
  },

  async updateMe(userId, { name, email, accountType, businessName, gstin }) {
    const user = await load(userId);
    if (name !== undefined) user.name = name;
    if (email !== undefined && (email ?? undefined) !== user.email) {
      user.email = email ?? undefined;
      user.emailVerifiedAt = undefined;
    }
    if (accountType !== undefined) user.accountType = accountType;
    if (businessName !== undefined) user.set('business.name', businessName);
    if (gstin !== undefined) user.set('business.gstin', gstin ?? undefined);
    if (user.accountType === 'business' && !user.business?.name) {
      throw ApiError.unprocessable('Business name is required for business accounts', {
        details: [{ path: 'businessName', message: 'Required' }],
      });
    }
    try {
      await user.save();
    } catch (err) {
      if (err?.code === 11000)
        throw ApiError.conflict('This email is already used by another account', {
          details: [{ path: 'email', message: 'Already in use' }],
        });
      throw err;
    }
    return serializeUser(user.toObject());
  },

  async addresses(userId) {
    const user = await User.findById(userId).select('addresses').lean();
    return user?.addresses ?? [];
  },

  async addAddress(userId, input) {
    const user = await load(userId);
    if (user.addresses.length >= MAX_ADDRESSES) throw ApiError.unprocessable(`You can save up to ${MAX_ADDRESSES} addresses`);
    user.addresses.push(input);
    const added = user.addresses.at(-1);
    ensureSingleDefault(user, input.isDefault || user.addresses.length === 1 ? added._id : undefined);
    await user.save();
    return user.addresses.map((a) => a.toObject());
  },

  async updateAddress(userId, addressId, input) {
    const user = await load(userId);
    const address = user.addresses.id(addressId);
    if (!address) throw ApiError.notFound('Address not found');
    address.set(input);
    ensureSingleDefault(user, input.isDefault ? address._id : undefined);
    await user.save();
    return user.addresses.map((a) => a.toObject());
  },

  async removeAddress(userId, addressId) {
    const user = await load(userId);
    const address = user.addresses.id(addressId);
    if (!address) throw ApiError.notFound('Address not found');
    address.deleteOne();
    ensureSingleDefault(user);
    await user.save();
    return user.addresses.map((a) => a.toObject());
  },

  async address(userId, addressId) {
    const user = await User.findById(userId).select('addresses').lean();
    const address = user?.addresses.find((a) => String(a._id) === String(addressId));
    if (!address) throw ApiError.unprocessable('Choose a delivery address', { code: 'ADDRESS_NOT_FOUND' });
    return address;
  },

  /* ─────────────── Admin ─────────────── */

  async adminList({ page, limit, status, q }) {
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { 'business.name': rx }, { 'business.gstin': rx }];
    }
    const [rows, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    return {
      items: rows.map((u) => ({ ...serializeUser(u), lastLoginAt: u.lastLoginAt ?? null, addressCount: u.addresses?.length ?? 0 })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async adminGet(id) {
    const user = await User.findById(id).lean();
    if (!user) throw ApiError.notFound('User not found');
    return { ...serializeUser(user), addresses: user.addresses, lastLoginAt: user.lastLoginAt ?? null };
  },

  async adminSetStatus(id, status) {
    const user = await User.findByIdAndUpdate(id, { status }, { returnDocument: 'after' }).lean();
    if (!user) throw ApiError.notFound('User not found');
    if (status === 'blocked') await sessionService.revokeAll(user._id, 'user', 'admin');
    return serializeUser(user);
  },
};
