import { ONBOARDING_STEPS } from './vendor.model.js';

/** Vendor as seen by the vendor themselves (and admins). Bank a/c number is only ever masked. */
export function serializeVendor(vendor) {
  if (!vendor) return null;
  const completed = vendor.onboarding?.completedSteps ?? [];
  return {
    _id: vendor._id,
    role: 'vendor',
    phone: vendor.phone,
    contactName: vendor.contactName,
    email: vendor.email,
    emailVerified: Boolean(vendor.emailVerifiedAt),
    status: vendor.status,
    store: vendor.store ?? null,
    business: vendor.business ?? null,
    address: vendor.address ?? null,
    bank: vendor.bank?.ifsc
      ? {
          accountHolderName: vendor.bank.accountHolderName,
          accountNumberMasked: vendor.bank.accountNumberLast4 ? `XXXXXX${vendor.bank.accountNumberLast4}` : null,
          ifsc: vendor.bank.ifsc,
          bankName: vendor.bank.bankName ?? null,
          branch: vendor.bank.branch ?? null,
        }
      : null,
    documents: vendor.documents ?? [],
    onboarding: {
      completedSteps: completed,
      steps: ONBOARDING_STEPS,
      isComplete: ONBOARDING_STEPS.every((s) => completed.includes(s)),
      submittedAt: vendor.onboarding?.submittedAt ?? null,
    },
    review:
      vendor.review?.reviewedAt || vendor.review?.note ? { reviewedAt: vendor.review.reviewedAt, note: vendor.review.note ?? null } : null,
    lastLoginAt: vendor.lastLoginAt ?? null,
    createdAt: vendor.createdAt,
  };
}

/**
 * What admins without Vendors access get when they look a seller up (e.g. to import products for
 * them): enough to pick the right store, no KYC, bank details or documents.
 */
export function serializeVendorLookup(vendor) {
  if (!vendor) return null;
  return {
    _id: vendor._id,
    role: 'vendor',
    phone: vendor.phone,
    contactName: vendor.contactName,
    status: vendor.status,
    store: vendor.store ? { name: vendor.store.name, slug: vendor.store.slug, logo: vendor.store.logo ?? null } : null,
  };
}

/** Public storefront view of a vendor. */
export function serializePublicVendor(vendor) {
  if (!vendor) return null;
  return {
    _id: vendor._id,
    store: {
      name: vendor.store?.name,
      slug: vendor.store?.slug,
      logo: vendor.store?.logo ?? null,
      description: vendor.store?.description ?? null,
    },
    city: vendor.address?.city ?? null,
    state: vendor.address?.state ?? null,
    memberSince: vendor.createdAt,
    official: Boolean(vendor.isPlatform),
  };
}
