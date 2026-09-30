import { ApiError } from '#core/errors/ApiError.js';
import { gstFromInclusive } from '#core/utils/money.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { serializeProductCard } from '#modules/products/product.serializer.js';
import { settingsService } from '#services/settings/settings.service.js';
import { Cart, MAX_CART_ITEMS } from './cart.model.js';

const PRICING_FIELDS = 'name slug type brand condition images pricing inventory hsnCode sku vendor isFeatured status vendorApproved';

export function shippingFee(subtotal, { flatFee, freeAbove }) {
  if (!flatFee || subtotal === 0) return 0;
  if (freeAbove > 0 && subtotal >= freeAbove) return 0;
  return flatFee;
}

/** Upper bound a customer can order right now for a product. */
const maxOrderable = (p) => Math.min(p.inventory.stock, p.inventory.maxOrderQty ?? Number.MAX_SAFE_INTEGER);

function lineIssue(product, quantity) {
  if (!product || product.status !== VISIBLE.status || !product.vendorApproved) return 'unavailable';
  if (product.inventory.stock <= 0) return 'out_of_stock';
  if (quantity < product.inventory.moq) return 'below_moq';
  if (quantity > maxOrderable(product)) return 'exceeds_stock';
  return null;
}

async function assertOrderable(productId, quantity) {
  const product = await Product.findOne({ _id: productId, ...VISIBLE }).select(PRICING_FIELDS).lean();
  if (!product) throw ApiError.notFound('This product is no longer available', { code: 'PRODUCT_UNAVAILABLE' });
  const issue = lineIssue(product, quantity);
  if (issue === 'out_of_stock') throw ApiError.conflict(`${product.name} is out of stock`, { code: 'OUT_OF_STOCK' });
  if (issue === 'below_moq') {
    throw ApiError.unprocessable(`Minimum order quantity is ${product.inventory.moq}`, { code: 'BELOW_MOQ', details: { moq: product.inventory.moq } });
  }
  if (issue === 'exceeds_stock') {
    const max = maxOrderable(product);
    throw ApiError.unprocessable(`You can order at most ${max} of this item`, { code: 'EXCEEDS_STOCK', details: { max } });
  }
  return product;
}

export const cartService = {
  /**
   * Priced view of the cart using live product data. `issues` explains lines that can't be checked out.
   * @returns {{ items: any[], summary: object, hasIssues: boolean }}
   */
  async view(userId) {
    const cart = await Cart.findOne({ user: userId }).lean();
    const entries = cart?.items ?? [];
    const products = await Product.find({ _id: { $in: entries.map((i) => i.product) } }).select(PRICING_FIELDS).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const items = entries.map(({ product: productId, quantity }) => {
      const product = byId.get(String(productId));
      const issue = lineIssue(product, quantity);
      const unitPrice = product?.pricing.price ?? 0;
      return {
        productId,
        product: product ? serializeProductCard(product) : null,
        vendor: product?.vendor ?? null,
        quantity,
        unitPrice,
        unitMrp: product?.pricing.mrp ?? 0,
        gstRate: product?.pricing.gstRate ?? 0,
        lineTotal: unitPrice * quantity,
        maxQuantity: product ? maxOrderable(product) : 0,
        issue,
        _product: product,
      };
    });

    const payable = items.filter((i) => !i.issue);
    const subtotal = payable.reduce((sum, i) => sum + i.lineTotal, 0);
    const mrpTotal = payable.reduce((sum, i) => sum + i.unitMrp * i.quantity, 0);
    const tax = payable.reduce((sum, i) => sum + gstFromInclusive(i.lineTotal, i.gstRate), 0);
    const shipping = shippingFee(subtotal, await settingsService.get('shipping'));

    return {
      items,
      summary: {
        itemCount: payable.reduce((n, i) => n + i.quantity, 0),
        subtotal,
        mrpTotal,
        savings: mrpTotal - subtotal,
        tax,
        shipping,
        total: subtotal + shipping,
      },
      hasIssues: items.some((i) => i.issue),
    };
  },

  /** Public representation (drops the internal product document). */
  async get(userId) {
    const view = await this.view(userId);
    return { ...view, items: view.items.map(({ _product, ...rest }) => rest) };
  },

  async setItem(userId, productId, quantity) {
    await assertOrderable(productId, quantity);
    const updated = await Cart.findOneAndUpdate(
      { user: userId, 'items.product': productId },
      { $set: { 'items.$.quantity': quantity } },
      { returnDocument: 'after' },
    );
    if (!updated) {
      const cart = await Cart.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, returnDocument: 'after' });
      if (cart.items.length >= MAX_CART_ITEMS) throw ApiError.unprocessable(`Your cart can hold up to ${MAX_CART_ITEMS} different items`);
      await Cart.updateOne({ user: userId, 'items.product': { $ne: productId } }, { $push: { items: { product: productId, quantity } } });
    }
    return this.get(userId);
  },

  async removeItem(userId, productId) {
    await Cart.updateOne({ user: userId }, { $pull: { items: { product: productId } } });
    return this.get(userId);
  },

  /** Merges a guest (localStorage) cart after sign-in. Invalid lines are skipped, not fatal. */
  async merge(userId, lines) {
    for (const { productId, quantity } of lines.slice(0, MAX_CART_ITEMS)) {
      const product = await Product.findOne({ _id: productId, ...VISIBLE }).select(PRICING_FIELDS).lean();
      if (!product || product.inventory.stock <= 0) continue;
      const qty = Math.max(product.inventory.moq, Math.min(quantity, maxOrderable(product)));
      await this.setItem(userId, productId, qty).catch(() => {});
    }
    return this.get(userId);
  },

  async removeProducts(userId, productIds) {
    await Cart.updateOne({ user: userId }, { $pull: { items: { product: { $in: productIds } } } });
  },
};
