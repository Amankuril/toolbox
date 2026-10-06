import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { decrypt, encrypt } from '#core/utils/crypto.js';
import { escapeRegex } from '#core/utils/strings.js';
import { sessionService } from '#modules/auth/session.service.js';
import { mediaService } from '#modules/media/media.service.js';
import { Product } from '#modules/products/product.model.js';
import { productService } from '#modules/products/product.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { ONBOARDING_STEPS, Vendor } from './vendor.model.js';
import { serializePublicVendor, serializeVendor } from './vendor.serializer.js';

/** Business, bank and document details are frozen once submitted, so what an admin approved can't silently change. */
const EDITABLE_STATUSES = ['onboarding', 'rejected'];

async function loadEditable(vendorId) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  if (!EDITABLE_STATUSES.includes(vendor.status)) {
    throw ApiError.conflict('These details are locked after submission. Contact support to change them.', {
      code: 'VENDOR_DETAILS_LOCKED',
    });
  }
  return vendor;
}

function completeStep(vendor, step) {
  if (!vendor.onboarding.completedSteps.includes(step)) vendor.onboarding.completedSteps.push(step);
}

async function saveAndSerialize(vendor) {
  try {
    await vendor.save();
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.['business.gstin']) {
      throw ApiError.conflict('Another seller is already registered with this GSTIN', {
        code: 'DUPLICATE_GSTIN',
        details: [{ path: 'gstin', message: 'Already registered' }],
      });
    }
    throw err;
  }
  return serializeVendor(vendor.toObject());
}

async function productStats(vendorId) {
  const rows = await Product.aggregate([{ $match: { vendor: vendorId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

export const vendorService = {
  async me(vendorId) {
    const vendor = await Vendor.findById(vendorId).lean();
    if (!vendor) throw ApiError.notFound('Vendor not found');
    return serializeVendor(vendor);
  },

  /* ─────────────── Onboarding wizard ─────────────── */

  async saveBusiness(vendorId, { storeName, storeDescription, ...business }) {
    const vendor = await loadEditable(vendorId);
    vendor.business = business;
    if (storeName) vendor.store.name = storeName;
    if (storeDescription !== undefined) vendor.store.description = storeDescription;
    completeStep(vendor, 'business');
    return saveAndSerialize(vendor);
  },

  async saveAddress(vendorId, address) {
    const vendor = await loadEditable(vendorId);
    vendor.address = address;
    completeStep(vendor, 'address');
    return saveAndSerialize(vendor);
  },

  async saveBank(vendorId, { accountNumber, confirmAccountNumber: _confirm, ...bank }) {
    const vendor = await loadEditable(vendorId);
    vendor.bank = { ...bank, accountNumberEnc: encrypt(accountNumber), accountNumberLast4: accountNumber.slice(-4) };
    completeStep(vendor, 'bank');
    return saveAndSerialize(vendor);
  },

  async saveDocuments(vendorId, { documents }) {
    const vendor = await loadEditable(vendorId);
    const resolved = await mediaService.resolve(documents, { kind: 'vendor', id: vendorId });
    vendor.documents = documents.map((d, i) => ({ type: d.type, media: resolved[i].media, url: resolved[i].url }));
    completeStep(vendor, 'documents');
    return saveAndSerialize(vendor);
  },

  async submit(vendorId) {
    const vendor = await loadEditable(vendorId);
    const missing = ONBOARDING_STEPS.filter((s) => !vendor.onboarding.completedSteps.includes(s));
    if (missing.length) {
      throw ApiError.unprocessable(`Complete these steps first: ${missing.join(', ')}`, {
        code: 'ONBOARDING_INCOMPLETE',
        details: missing,
      });
    }

    const { autoApproveVendors } = await settingsService.get('moderation');
    vendor.onboarding.submittedAt = new Date();
    vendor.status = autoApproveVendors ? 'approved' : 'pending_review';
    if (autoApproveVendors) vendor.review = { reviewedAt: new Date() };

    const result = await saveAndSerialize(vendor);
    if (autoApproveVendors) await productService.syncVendorVisibility(vendor._id, true);
    return result;
  },

  async updateProfile(vendorId, { contactName, email, storeName, storeDescription, logo }) {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) throw ApiError.notFound('Vendor not found');
    if (contactName !== undefined) vendor.contactName = contactName;
    if (email !== undefined && email !== vendor.email) {
      if (await Vendor.exists({ email, _id: { $ne: vendorId } })) {
        throw ApiError.conflict('This email is already used by another seller account', {
          details: [{ path: 'email', message: 'Already in use' }],
        });
      }
      vendor.email = email;
      vendor.emailVerifiedAt = undefined;
    }
    if (storeName !== undefined) vendor.store.name = storeName;
    if (storeDescription !== undefined) vendor.store.description = storeDescription;
    if (logo !== undefined) vendor.store.logo = logo ? await mediaService.resolveOne(logo, { kind: 'vendor', id: vendorId }) : undefined;
    return saveAndSerialize(vendor);
  },

  /* ─────────────── Admin ─────────────── */

  async adminList({ page, limit, status, q }) {
    // The platform's own store is managed under Admin → Our store, not as a seller.
    const filter = { isPlatform: { $ne: true } };
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { 'store.name': rx },
        { contactName: rx },
        { phone: rx },
        { email: rx },
        { 'business.gstin': rx },
        { 'business.legalName': rx },
      ];
    }
    const [rows, total] = await Promise.all([
      Vendor.find(filter)
        .sort({ status: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Vendor.countDocuments(filter),
    ]);
    return { items: rows.map(serializeVendor), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async adminGet(id) {
    const vendor = await Vendor.findById(id).lean();
    if (!vendor || vendor.isPlatform) throw ApiError.notFound('Vendor not found');
    return { ...serializeVendor(vendor), productStats: await productStats(vendor._id) };
  },

  async adminReview(id, { action, note }, admin) {
    const vendor = await Vendor.findById(id);
    if (!vendor || vendor.isPlatform) throw ApiError.notFound('Vendor not found');
    if (vendor.status !== 'pending_review')
      throw ApiError.conflict('Only submitted applications can be reviewed', { code: 'INVALID_STATUS' });

    vendor.status = action === 'approve' ? 'approved' : 'rejected';
    vendor.review = { reviewedAt: new Date(), reviewedBy: admin.id, note: action === 'reject' ? note : undefined };
    const result = await saveAndSerialize(vendor);
    await productService.syncVendorVisibility(vendor._id, action === 'approve');
    return result;
  },

  async adminSuspend(id, { note }, admin) {
    const vendor = await Vendor.findById(id);
    if (!vendor || vendor.isPlatform) throw ApiError.notFound('Vendor not found');
    if (vendor.status === 'suspended') throw ApiError.conflict('Vendor is already suspended');

    vendor.status = 'suspended';
    vendor.review = { ...vendor.review?.toObject?.(), reviewedAt: new Date(), reviewedBy: admin.id, note };
    const result = await saveAndSerialize(vendor);
    await Promise.all([productService.syncVendorVisibility(vendor._id, false), sessionService.revokeAll(vendor._id, 'vendor', 'admin')]);
    return result;
  },

  async adminReinstate(id, admin) {
    const vendor = await Vendor.findById(id);
    if (!vendor || vendor.isPlatform) throw ApiError.notFound('Vendor not found');
    if (vendor.status !== 'suspended') throw ApiError.conflict('Only suspended vendors can be reinstated');

    // Vendors suspended before ever submitting go back to onboarding rather than straight to approved.
    const wasApproved = Boolean(vendor.onboarding?.submittedAt);
    vendor.status = wasApproved ? 'approved' : 'onboarding';
    vendor.review = { reviewedAt: new Date(), reviewedBy: admin.id };
    const result = await saveAndSerialize(vendor);
    if (wasApproved) await productService.syncVendorVisibility(vendor._id, true);
    return result;
  },

  /** Full account number for payout operations. Every access is logged. */
  async adminRevealBank(id, admin) {
    const vendor = await Vendor.findById(id).select('+bank.accountNumberEnc').lean();
    if (!vendor?.bank?.accountNumberEnc) throw ApiError.notFound('No bank account on file');
    logger.info({ vendorId: id, adminId: admin.id }, 'Vendor bank account revealed');
    return {
      accountNumber: decrypt(vendor.bank.accountNumberEnc),
      ifsc: vendor.bank.ifsc,
      accountHolderName: vendor.bank.accountHolderName,
    };
  },

  /* ─────────────── Public ─────────────── */

  async publicStore(slug) {
    const vendor = await Vendor.findOne({ 'store.slug': slug, status: 'approved' }).lean();
    if (!vendor) throw ApiError.notFound('Store not found');
    return serializePublicVendor(vendor);
  },
};
