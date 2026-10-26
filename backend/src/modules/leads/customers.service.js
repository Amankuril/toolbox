import mongoose from 'mongoose';
import { escapeRegex } from '#core/utils/strings.js';
import { Cart } from '#modules/cart/cart.model.js';
import { Order } from '#modules/orders/order.model.js';
import { User } from '#modules/users/user.model.js';
import { WhatsappLead } from './lead.model.js';

/**
 * A seller's customers: buyers who ordered from them, have their products in a cart, or tapped
 * "Chat on WhatsApp" on one. Sellers never see the marketplace's whole customer list.
 */
export async function sellerCustomers(vendorId, { page, limit, q }) {
  const vid = new mongoose.Types.ObjectId(String(vendorId));
  const [ordered, carted, chatted] = await Promise.all([
    Order.aggregate([
      { $match: { vendors: vid, status: { $ne: 'pending_payment' } } },
      { $group: { _id: '$user', orders: { $sum: 1 }, lastOrderAt: { $max: '$createdAt' } } },
    ]),
    Cart.distinct('user', { 'items.vendor': vid }),
    WhatsappLead.distinct('user', { vendor: vid }),
  ]);
  const orders = new Map(ordered.map((o) => [String(o._id), o]));
  const inCart = new Set(carted.map(String));
  const chats = new Set(chatted.map(String));
  const ids = [...new Set([...orders.keys(), ...inCart, ...chats])];

  const filter = { _id: { $in: ids }, status: 'active' };
  if (q) {
    const rx = new RegExp(escapeRegex(q.replace(/^\+?91(?=\d{10}$)/, '')), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  const [rows, total] = await Promise.all([
    User.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name phone email accountType createdAt')
      .lean(),
    User.countDocuments(filter),
  ]);
  return {
    items: rows.map((u) => {
      const o = orders.get(String(u._id));
      return {
        _id: u._id,
        name: u.name,
        phone: u.phone ?? null,
        email: u.email ?? null,
        accountType: u.accountType,
        orders: o?.orders ?? 0,
        lastOrderAt: o?.lastOrderAt ?? null,
        inCart: inCart.has(String(u._id)),
        chatted: chats.has(String(u._id)),
      };
    }),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}
