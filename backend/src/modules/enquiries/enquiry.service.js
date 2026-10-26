import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex } from '#core/utils/strings.js';
import { isInStock, variantTitle } from '#modules/products/inventory.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { Enquiry } from './enquiry.model.js';

function serialize(e) {
  return {
    _id: e._id,
    product: { _id: e.product?._id ?? e.product, name: e.productName, slug: e.productSlug, image: e.productImage ?? null, inStock: e.product?.inventory ? isInStock(e.product) : null },
    vendor: e.vendor?.store ? { _id: e.vendor._id, name: e.vendor.store.name } : e.vendor,
    variant: e.variant?.title ?? null,
    user: e.user ?? null,
    name: e.name,
    phone: e.phone,
    quantity: e.quantity,
    message: e.message ?? null,
    status: e.status,
    contactedAt: e.contactedAt ?? null,
    createdAt: e.createdAt,
  };
}

export const enquiryService = {
  /** From the product page. One open enquiry per number and product: asking again just updates it. */
  async create(productId, { name, phone, quantity, message, variantId }, userId) {
    const product = await Product.findOne({ _id: productId, ...VISIBLE }).select('name slug images vendor variantOptions variants inventory').lean();
    if (!product) throw ApiError.notFound('This product is no longer available');
    const variant = variantId ? product.variants.find((v) => String(v._id) === String(variantId)) : null;
    const doc = await Enquiry.findOneAndUpdate(
      { product: product._id, phone, status: 'open' },
      {
        $set: {
          vendor: product.vendor,
          productName: product.name,
          productSlug: product.slug,
          productImage: variant?.image?.url ?? product.images?.[0]?.url,
          ...(variant ? { variant: { id: variant._id, title: variantTitle(product, variant) } } : {}),
          ...(userId ? { user: userId } : {}),
          name,
          quantity,
          message,
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean();
    return { _id: doc._id, status: doc.status };
  },

  /** `vendorId` limits it to a seller's products; admins see everyone's. */
  async list({ vendorId, vendor, status, q, page, limit }) {
    const filter = {};
    if (vendorId) filter.vendor = vendorId;
    else if (vendor) filter.vendor = vendor;
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q.replace(/^\+?91(?=\d{10}$)/, '')), 'i');
      filter.$or = [{ name: rx }, { phone: rx }, { productName: rx }];
    }
    const [rows, total, counts] = await Promise.all([
      Enquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('product', 'inventory variants')
        .populate('vendor', 'store.name')
        .lean(),
      Enquiry.countDocuments(filter),
      Enquiry.aggregate([{ $match: vendorId ? { vendor: vendorId } : {} }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    return {
      items: rows.map(serialize),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) },
    };
  },

  async setStatus(id, status, { vendorId } = {}) {
    const doc = await Enquiry.findOneAndUpdate(
      { _id: id, ...(vendorId ? { vendor: vendorId } : {}) },
      { status, ...(status === 'contacted' ? { contactedAt: new Date() } : {}) },
      { returnDocument: 'after' },
    )
      .populate('product', 'inventory variants')
      .populate('vendor', 'store.name')
      .lean();
    if (!doc) throw ApiError.notFound('Enquiry not found');
    return serialize(doc);
  },
};
