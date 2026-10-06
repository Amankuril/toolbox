import { ApiError } from '#core/errors/ApiError.js';
import { uniqueSlug } from '#core/utils/strings.js';
import { mediaService } from '#modules/media/media.service.js';
import { ONBOARDING_STEPS, Vendor } from '#modules/vendors/vendor.model.js';
import { serializeVendor } from '#modules/vendors/vendor.serializer.js';

export const DEFAULT_STORE_NAME = 'ToolsHubs Official';
// Placeholder until an admin sets the pickup phone; not a valid number, so it can never match a sign-in.
const NO_PHONE = 'platform-store';
const NO_EMAIL = 'store@platform.invalid';

let cachedId = null;

/** Store settings as the admin panel edits them: placeholders come back as empty. */
function serializeStore(v) {
  const s = serializeVendor(v);
  return {
    ...s,
    phone: v.phone === NO_PHONE ? null : v.phone,
    email: v.email === NO_EMAIL ? null : v.email,
    official: true,
    // Shipping needs a real pickup contact and address before the first label can be booked.
    readyToShip: v.phone !== NO_PHONE && Boolean(v.address?.pincode),
  };
}

/**
 * The marketplace's own store. Behind the scenes it is a seller record (so products, carts,
 * order splitting, shipping and reviews all work unchanged), but it has no login: admins run
 * it from the admin panel through /admin/store, which acts as this seller.
 */
export const storeService = {
  async ensure() {
    if (cachedId) {
      const hit = await Vendor.findById(cachedId).lean();
      if (hit) return hit;
      cachedId = null;
    }
    let store = await Vendor.findOne({ isPlatform: true }).lean();
    if (!store) {
      try {
        store = (
          await Vendor.create({
            isPlatform: true,
            phone: NO_PHONE,
            email: NO_EMAIL,
            contactName: DEFAULT_STORE_NAME,
            status: 'approved',
            store: { name: DEFAULT_STORE_NAME, slug: await uniqueSlug(Vendor, DEFAULT_STORE_NAME, { field: 'store.slug' }) },
            onboarding: { completedSteps: ONBOARDING_STEPS, submittedAt: new Date() },
            review: { reviewedAt: new Date() },
          })
        ).toObject();
      } catch (err) {
        // Two first requests at once: the unique index lets one win; use that one.
        if (err?.code !== 11000) throw err;
        store = await Vendor.findOne({ isPlatform: true }).lean();
      }
    }
    cachedId = store._id;
    return store;
  },

  async get() {
    return serializeStore(await this.ensure());
  },

  async update({ storeName, storeDescription, logo, contactName, phone, email, address, gstin, legalName }) {
    const { _id } = await this.ensure();
    const store = await Vendor.findById(_id);
    if (storeName !== undefined) store.store.name = storeName;
    if (storeDescription !== undefined) store.store.description = storeDescription;
    if (logo !== undefined) store.store.logo = logo ? await mediaService.resolveOne(logo, { kind: 'vendor', id: _id }) : undefined;
    if (contactName !== undefined) store.contactName = contactName;
    if (phone !== undefined && phone !== store.phone) {
      if (await Vendor.exists({ phone, _id: { $ne: _id } })) {
        throw ApiError.conflict('A seller account already uses this mobile number', {
          details: [{ path: 'phone', message: 'Already in use' }],
        });
      }
      store.phone = phone;
    }
    if (email !== undefined) store.email = email;
    if (address !== undefined) {
      const moved = store.address?.pincode !== address.pincode || store.address?.line1 !== address.line1;
      store.address = address;
      // A new pickup address must be registered with the courier again.
      if (moved) store.shipping = { warehouseId: undefined, warehouseSyncedAt: undefined };
    }
    if (gstin !== undefined || legalName !== undefined) {
      store.business = {
        ...store.business?.toObject?.(),
        ...(gstin !== undefined ? { gstin: gstin || undefined } : {}),
        ...(legalName !== undefined ? { legalName } : {}),
      };
    }
    await store.save();
    return serializeStore(store.toObject());
  },
};

/**
 * Runs the seller routes as the platform store. Mounted after the admin's section check, so the
 * admin's own permissions decide access; inside, the request looks like the store's seller session.
 */
export async function actAsStore(req, _res, next) {
  const store = await storeService.ensure();
  req.admin = { id: req.auth.id, account: req.account };
  req.auth = { audience: 'vendor', id: store._id, role: undefined, actingAdmin: req.auth.id };
  req.account = store;
  next();
}
