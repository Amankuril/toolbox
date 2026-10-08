import mongoose from 'mongoose';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex } from '#core/utils/strings.js';
import { Cart } from '#modules/cart/cart.model.js';
import { priceEntries, PRICING_FIELDS, shippingFee } from '#modules/cart/cart.service.js';
import { couponService } from '#modules/coupons/coupon.service.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { Quote } from '#modules/quotes/quote.model.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { chatNumber } from '#modules/vendors/vendor.serializer.js';
import { settingsService } from '#services/settings/settings.service.js';
import { LeadContact, MAX_LEAD_PRODUCTS, WhatsappLead } from './lead.model.js';

/** A cart untouched for this long counts as abandoned; anything more recent is active. */
export const ABANDONED_AFTER_MS = 60 * 60_000;
const DAY = 24 * 60 * 60_000;
const PERIOD_DAYS = { '24h': 1, '7d': 7, '30d': 30 };

const appUrl = (path) => `${env.PUBLIC_APP_URL.replace(/\/+$/, '')}${path}`;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const date = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

// Not wa.me: its redirect replaces every emoji with "�" (U+FFFD). api.whatsapp.com passes them through.
export const whatsappUrl = (phone, text) =>
  `https://api.whatsapp.com/send?phone=${phone.replace(/\D/g, '')}&text=${encodeURIComponent(text)}`;
export const smsUrl = (phone, text) => `sms:${phone}?body=${encodeURIComponent(text)}`;
// SMS apps render emoji inconsistently (and they cost extra characters), so SMS gets the plain text.
const plain = (text) =>
  text
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.!,])/g, '$1')
    .trim();

/* ─────────────── Messages ─────────────── */

function offerText(coupon) {
  const off =
    coupon.type === 'percent'
      ? `${coupon.value}% off${coupon.maxDiscount ? ` (up to ${rupees(coupon.maxDiscount)})` : ''}`
      : `${rupees(coupon.value)} off`;
  const conditions = [
    coupon.minOrderValue ? `on orders of ${rupees(coupon.minOrderValue)} or more` : null,
    coupon.expiresAt ? `valid till ${date(coupon.expiresAt)}` : null,
  ].filter(Boolean);
  return `${off}${coupon.description ? ` – ${coupon.description}` : ''}. Use code ${coupon.code} at checkout${conditions.length ? ` (${conditions.join(', ')})` : ''}.`;
}

export const leadMessages = {
  cartReminder: ({ store }) =>
    `Greetings from ${store}! Looks like you left some items in your cart 🛒. We have saved them for you! 👉 Use the link ${appUrl('/cart')} to place your order now.`,
  followUp: ({ store, customer, product, storeLink }) =>
    `Hi${customer ? ` ${customer}` : ''}, greetings from ${store}! ${product ? `You were looking at ${product.name}. ` : ''}Any questions? Reply here and we'll be happy to help. 👉 ${product ? appUrl(`/p/${product.slug}`) : storeLink}`,
  offer: ({ store, coupon, link }) => `Greetings from ${store}! 🎁 A special offer for you: ${offerText(coupon)} 👉 Shop now: ${link}`,
  chat: ({ store, product }) => `Hi ${store}, I'm interested in ${product.name}. ${appUrl(`/p/${product.slug}`)}`,
};

/* ─────────────── Helpers ─────────────── */

function cartWindow(tab, period) {
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS);
  const since = PERIOD_DAYS[period] ? new Date(Date.now() - PERIOD_DAYS[period] * DAY) : null;
  if (tab === 'active') return { $gte: cutoff };
  return { $lt: cutoff, ...(since ? { $gte: since } : {}) };
}

/** Users whose name, mobile or email matches `q` (search box). */
async function matchingUserIds(q) {
  const rx = new RegExp(escapeRegex(q.replace(/^\+?91(?=\d{10}$)/, '')), 'i');
  const users = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] })
    .select('_id')
    .limit(500)
    .lean();
  return users.map((u) => u._id);
}

/** Latest contact per buyer, for "Notification sent …". */
async function lastContacts(vendorId, userIds) {
  if (!userIds.length) return new Map();
  const rows = await LeadContact.aggregate([
    { $match: { vendor: oid(vendorId), user: { $in: userIds.map(oid) } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$user', at: { $first: '$createdAt' }, channel: { $first: '$channel' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { at: r.at, channel: r.channel }]));
}

/** The seller's lines in each cart, priced as their buyers see them. */
async function priceSellerCarts(vendorId, carts) {
  const linesByCart = carts.map((c) => c.items.filter((i) => String(i.vendor) === String(vendorId)));
  const all = linesByCart.flat();
  const [products, quotes, buyers] = await Promise.all([
    Product.find({ _id: { $in: all.map((i) => i.product) } })
      .select(PRICING_FIELDS)
      .lean(),
    Quote.find({ _id: { $in: all.filter((i) => i.quote).map((i) => i.quote) } }).lean(),
    User.find({ _id: { $in: carts.map((c) => c.user) } })
      .select('accountType')
      .lean(),
  ]);
  const productsById = new Map(products.map((p) => [String(p._id), p]));
  const quotesById = new Map(quotes.map((q) => [String(q._id), q]));
  const buyersById = new Map(buyers.map((b) => [String(b._id), b]));
  return carts.map((cart, k) => {
    const items = priceEntries(linesByCart[k], {
      userId: cart.user,
      buyer: buyersById.get(String(cart.user)) ?? null,
      productsById,
      quotesById,
    }).filter((i) => i.product);
    return {
      items,
      value: items.reduce((s, i) => s + i.lineTotal, 0),
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
    };
  });
}

const customerOf = (u) =>
  u
    ? { _id: u._id, name: u.name ?? null, phone: u.phone ?? null, email: u.email ?? null, accountType: u.accountType ?? 'individual' }
    : null;

const page = (items, total, p, limit) => ({ items, meta: { page: p, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });

/** Loads what a seller may see about a buyer; 404 unless the buyer is actually this seller's lead. */
async function loadLead(vendorId, userId) {
  const [cart, lead, user] = await Promise.all([
    Cart.findOne({ user: userId, 'items.vendor': vendorId }).lean(),
    WhatsappLead.findOne({ vendor: vendorId, user: userId }).lean(),
    User.findById(userId).select('name phone email accountType business addresses createdAt').lean(),
  ]);
  if (!user || (!cart && !lead)) throw ApiError.notFound('Lead not found');
  return { cart, lead, user };
}

export const leadsService = {
  ABANDONED_AFTER_MS,

  async counts(vendorId) {
    const [abandoned, active, whatsapp] = await Promise.all([
      Cart.countDocuments({ 'items.vendor': vendorId, updatedAt: cartWindow('abandoned') }),
      Cart.countDocuments({ 'items.vendor': vendorId, updatedAt: cartWindow('active') }),
      WhatsappLead.countDocuments({ vendor: vendorId }),
    ]);
    return { abandoned, active, whatsapp };
  },

  /** Abandoned or active carts holding this seller's products. */
  async carts(vendorId, { tab, page: p, limit, q, sort, period }) {
    const filter = { 'items.vendor': oid(vendorId), updatedAt: cartWindow(tab, period) };
    if (q) filter.user = { $in: await matchingUserIds(q) };
    const [carts, total] = await Promise.all([
      Cart.find(filter)
        .sort({ updatedAt: sort === 'oldest' ? 1 : -1 })
        .skip((p - 1) * limit)
        .limit(limit)
        .lean(),
      Cart.countDocuments(filter),
    ]);
    const userIds = carts.map((c) => c.user);
    const [priced, users, contacts] = await Promise.all([
      priceSellerCarts(vendorId, carts),
      User.find({ _id: { $in: userIds } })
        .select('name phone email accountType')
        .lean(),
      lastContacts(vendorId, userIds),
    ]);
    const usersById = new Map(users.map((u) => [String(u._id), u]));
    const items = carts.map((c, k) => ({
      userId: c.user,
      customer: customerOf(usersById.get(String(c.user))),
      updatedAt: c.updatedAt,
      value: priced[k].value,
      itemCount: priced[k].itemCount,
      lastContact: contacts.get(String(c.user)) ?? null,
    }));
    return page(items, total, p, limit);
  },

  /** Buyers who tapped "Chat on WhatsApp" on this seller's products. */
  async whatsapp(vendorId, { page: p, limit, q, sort, period }) {
    const filter = { vendor: oid(vendorId) };
    if (q) filter.user = { $in: await matchingUserIds(q) };
    if (PERIOD_DAYS[period]) filter.lastAt = { $gte: new Date(Date.now() - PERIOD_DAYS[period] * DAY) };
    const [leads, total] = await Promise.all([
      WhatsappLead.find(filter)
        .sort({ lastAt: sort === 'oldest' ? 1 : -1 })
        .skip((p - 1) * limit)
        .limit(limit)
        .lean(),
      WhatsappLead.countDocuments(filter),
    ]);
    const userIds = leads.map((l) => l.user);
    const [users, contacts] = await Promise.all([
      User.find({ _id: { $in: userIds } })
        .select('name phone email accountType')
        .lean(),
      lastContacts(vendorId, userIds),
    ]);
    const usersById = new Map(users.map((u) => [String(u._id), u]));
    const items = leads.map((l) => ({
      userId: l.user,
      customer: customerOf(usersById.get(String(l.user))),
      lastAt: l.lastAt,
      clicks: l.clicks,
      products: l.products.slice(0, 3).map(({ product, name, slug }) => ({ _id: product, name, slug })),
      lastContact: contacts.get(String(l.user)) ?? null,
    }));
    return page(items, total, p, limit);
  },

  /** Everything the lead page shows about one buyer, limited to this seller's side of things. */
  async customer(vendorId, userId) {
    const { cart, lead, user } = await loadLead(vendorId, userId);
    const [priced] = cart ? await priceSellerCarts(vendorId, [cart]) : [null];
    const [shippingSettings, contacts] = await Promise.all([
      settingsService.get('shipping'),
      LeadContact.find({ vendor: vendorId, user: userId }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    const address = user.addresses?.find((a) => a.isDefault) ?? user.addresses?.[0];
    const delivery = priced?.items.length ? shippingFee(priced.value, shippingSettings) : 0;

    return {
      customer: {
        ...customerOf(user),
        business:
          user.accountType === 'business' && user.business?.name ? { name: user.business.name, gstin: user.business.gstin ?? null } : null,
        memberSince: user.createdAt,
      },
      status: cart ? (Date.now() - new Date(cart.updatedAt).getTime() >= ABANDONED_AFTER_MS ? 'abandoned' : 'active') : null,
      cart: priced
        ? {
            updatedAt: cart.updatedAt,
            items: priced.items.map((i) => ({
              productId: i.productId,
              name: i.product.name,
              slug: i.product.slug,
              image: (i.variant?.image ?? i.product.image)?.url ?? null,
              variant: i.variant?.title ?? null,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
              pricing: { source: i.pricing.source },
              issue: i.issue ?? null,
            })),
            itemCount: priced.itemCount,
            subtotal: priced.value,
            delivery,
            total: priced.value + delivery,
          }
        : null,
      // Area only: the buyer hasn't ordered from this seller, so their street address stays private.
      area: address ? { city: address.city, state: address.state, pincode: address.pincode } : null,
      whatsapp: lead ? { clicks: lead.clicks, lastAt: lead.lastAt, products: lead.products } : null,
      contacts: contacts.map((c) => ({ channel: c.channel, kind: c.kind, couponCode: c.couponCode ?? null, at: c.createdAt })),
      canContact: Boolean(user.phone),
    };
  },

  /**
   * Builds the WhatsApp / SMS link a seller opens to reach a lead (cart reminder, follow-up, or an
   * offer with one of their coupons) and records the contact.
   */
  async contact(vendorId, userId, { channel, couponId }, actingAdmin) {
    const [{ cart, lead, user }, vendor] = await Promise.all([
      loadLead(vendorId, userId),
      Vendor.findById(vendorId).select('store').lean(),
    ]);
    if (!user.phone) {
      throw ApiError.unprocessable("This customer signed up with email and hasn't added a mobile number", { code: 'NO_PHONE' });
    }
    const store = vendor.store.name;
    const coupon = couponId ? await couponService.usableForVendor(vendorId, couponId) : null;
    const lastProduct = lead?.products?.[0];
    const storeLink = vendor.store.slug ? appUrl(`/store/${vendor.store.slug}`) : appUrl('/');

    let kind;
    let message;
    if (coupon) {
      kind = 'offer';
      message = leadMessages.offer({ store, coupon, link: cart ? appUrl('/cart') : storeLink });
    } else if (cart) {
      kind = 'cart_reminder';
      message = leadMessages.cartReminder({ store });
    } else {
      kind = 'follow_up';
      message = leadMessages.followUp({ store, customer: user.name?.split(' ')[0], product: lastProduct, storeLink });
    }

    const text = channel === 'sms' ? plain(message) : message;
    const contact = await LeadContact.create({
      vendor: vendorId,
      user: userId,
      channel,
      kind,
      ...(coupon ? { coupon: coupon._id, couponCode: coupon.code } : {}),
      ...(actingAdmin ? { by: actingAdmin } : {}),
    });
    return {
      channel,
      kind,
      message: text,
      url: channel === 'sms' ? smsUrl(user.phone, text) : whatsappUrl(user.phone, text),
      contactedAt: contact.createdAt,
    };
  },

  /* ─────────────── Buyer side ─────────────── */

  /** "Chat on WhatsApp" on a product: records the lead for the seller and returns the chat link. */
  async startChat(userId, productId) {
    const product = await Product.findOne({ _id: productId, ...VISIBLE })
      .select('name slug images vendor')
      .lean();
    if (!product) throw ApiError.notFound('This product is no longer available');
    const vendor = await Vendor.findOne({ _id: product.vendor, status: 'approved' }).select('store phone').lean();
    const number = vendor && chatNumber(vendor);
    if (!number) throw ApiError.conflict("This seller isn't taking WhatsApp chats right now", { code: 'CHAT_UNAVAILABLE' });

    const now = new Date();
    const entry = { product: product._id, name: product.name, slug: product.slug, image: product.images?.[0]?.url, at: now };
    // Most recent first, no repeats: drop this product's older entry, then put it on top.
    await WhatsappLead.updateOne({ vendor: vendor._id, user: userId }, { $pull: { products: { product: product._id } } });
    await WhatsappLead.updateOne(
      { vendor: vendor._id, user: userId },
      { $inc: { clicks: 1 }, $set: { lastAt: now }, $push: { products: { $each: [entry], $position: 0, $slice: MAX_LEAD_PRODUCTS } } },
      { upsert: true },
    );
    return { url: whatsappUrl(number, leadMessages.chat({ store: vendor.store.name, product })) };
  },
};
