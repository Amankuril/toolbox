import { ApiError } from '#core/errors/ApiError.js';
import { gstFromInclusive } from '#core/utils/money.js';
import { resolveSellable } from '#modules/products/inventory.js';
import { priceForQuantity } from '#modules/products/pricing.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { serializeProductCard } from '#modules/products/product.serializer.js';
import { Quote } from '#modules/quotes/quote.model.js';
import { User } from '#modules/users/user.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { Cart, MAX_CART_ITEMS } from './cart.model.js';

const PRICING_FIELDS =
  'name slug type brand modelNumber condition images pricing inventory hsnCode sku vendor isFeatured status vendorApproved bulkPricing specifications shipping variantOptions variants';

/** Matches a cart line; `variant: null` also matches lines saved before variants existed. */
const lineMatch = (productId, variantId) => ({ product: productId, variant: variantId ?? null });

function sellableOrNull(product, variantId) {
  try {
    return product ? resolveSellable(product, variantId) : null;
  } catch {
    return null;
  }
}

export function shippingFee(subtotal, { flatFee, freeAbove }) {
  if (!flatFee || subtotal === 0) return 0;
  if (freeAbove > 0 && subtotal >= freeAbove) return 0;
  return flatFee;
}

const MAX_QTY = 100_000;
/** Upper bound a customer can order right now (stock, or unlimited when untracked, capped by max per order). */
const maxOrderable = (p, sellable) => Math.min(sellable.available, p.inventory.maxOrderQty ?? MAX_QTY, MAX_QTY);

/** Quoted lines were negotiated for their quantity, so only stock limits them (not MOQ / max per order). */
function lineIssue(product, sellable, quantity, { quoted = false } = {}) {
  if (!product || !sellable || product.status !== VISIBLE.status || !product.vendorApproved) return 'unavailable';
  if (sellable.available <= 0) return 'out_of_stock';
  if (!quoted && quantity < product.inventory.moq) return 'below_moq';
  if (quantity > (quoted ? sellable.available : maxOrderable(product, sellable))) return 'exceeds_stock';
  return null;
}

/** A quote prices a cart line only while it's accepted, unexpired and matches the line exactly. */
function quoteUsable(quote, { userId, productId, quantity }) {
  return (
    quote?.status === 'accepted' &&
    String(quote.user) === String(userId) &&
    String(quote.product) === String(productId) &&
    quote.quantity === quantity &&
    quote.offer?.validUntil > new Date()
  );
}

async function assertOrderable(productId, quantity, variantId) {
  const product = await Product.findOne({ _id: productId, ...VISIBLE })
    .select(PRICING_FIELDS)
    .lean();
  if (!product) throw ApiError.notFound('This product is no longer available', { code: 'PRODUCT_UNAVAILABLE' });
  const sellable = resolveSellable(product, variantId);
  const issue = lineIssue(product, sellable, quantity);
  if (issue === 'out_of_stock') throw ApiError.conflict(`${product.name} is out of stock`, { code: 'OUT_OF_STOCK' });
  if (issue === 'below_moq') {
    throw ApiError.unprocessable(`Minimum order quantity is ${product.inventory.moq}`, {
      code: 'BELOW_MOQ',
      details: { moq: product.inventory.moq },
    });
  }
  if (issue === 'exceeds_stock') {
    const max = maxOrderable(product, sellable);
    throw ApiError.unprocessable(`You can order at most ${max} of this item`, { code: 'EXCEEDS_STOCK', details: { max } });
  }
  return product;
}

async function ensureCart(userId) {
  return Cart.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, returnDocument: 'after' });
}

export const cartService = {
  /**
   * Priced view of the cart using live product data and the buyer's account type.
   * Each line says where its unit price came from (base / bulk tier / accepted quote).
   * @returns {{ items: any[], summary: object, hasIssues: boolean }}
   */
  async view(userId) {
    const [cart, buyer] = await Promise.all([Cart.findOne({ user: userId }).lean(), User.findById(userId).select('accountType').lean()]);
    const entries = cart?.items ?? [];
    const [products, quotes] = await Promise.all([
      Product.find({ _id: { $in: entries.map((i) => i.product) } })
        .select(PRICING_FIELDS)
        .lean(),
      Quote.find({ _id: { $in: entries.filter((e) => e.quote).map((e) => e.quote) } }).lean(),
    ]);
    const productsById = new Map(products.map((p) => [String(p._id), p]));
    const quotesById = new Map(quotes.map((q) => [String(q._id), q]));

    const items = entries.map(({ product: productId, variant: variantId, quantity, quote: quoteId }) => {
      const product = productsById.get(String(productId));
      const sellable = sellableOrNull(product, variantId);
      const quote = quoteId ? quotesById.get(String(quoteId)) : null;
      const basePrice = sellable?.price ?? product?.pricing.price ?? 0;

      let issue;
      let pricing;
      if (quoteId) {
        if (quote?.status === 'ordered') issue = 'quote_in_order';
        else
          issue = quoteUsable(quote, { userId, productId, quantity })
            ? lineIssue(product, sellable, quantity, { quoted: true })
            : 'quote_expired';
        pricing = {
          source: 'quote',
          unitPrice: quote?.offer?.unitPrice ?? basePrice,
          tier: null,
          next: null,
          quote: quote ? { _id: quote._id, number: quote.number, validUntil: quote.offer?.validUntil ?? null } : null,
        };
      } else {
        issue = lineIssue(product, sellable, quantity);
        // Variants have their own price and no bulk tiers.
        const p = sellable?.variant
          ? { unitPrice: sellable.price, tier: null, next: null }
          : product
            ? priceForQuantity(product, quantity, buyer)
            : { unitPrice: 0, tier: null, next: null };
        pricing = { source: p.tier ? 'bulk' : 'base', unitPrice: p.unitPrice, tier: p.tier, next: p.next, quote: null };
      }

      const { unitPrice } = pricing;
      return {
        productId,
        variantId: variantId ?? null,
        variant: sellable?.variant ? { _id: sellable.variant._id, title: sellable.title, image: sellable.variant.image ?? null } : null,
        sku: sellable?.sku ?? null,
        product: product ? serializeProductCard(product) : null,
        vendor: product?.vendor ?? null,
        quantity,
        quantityLocked: Boolean(quoteId),
        unitPrice,
        baseUnitPrice: basePrice,
        unitMrp: sellable?.mrp ?? product?.pricing.mrp ?? 0,
        gstRate: product?.pricing.gstRate ?? 0,
        lineTotal: unitPrice * quantity,
        bulkSavings: Math.max(0, (basePrice - unitPrice) * quantity),
        pricing: { source: pricing.source, tier: pricing.tier, next: pricing.next, quote: pricing.quote },
        maxQuantity: product && sellable ? Math.min(MAX_QTY, quoteId ? sellable.available : maxOrderable(product, sellable)) : 0,
        issue,
        _product: product,
        _sellable: sellable,
        _quote: quote,
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
        bulkSavings: payable.reduce((sum, i) => sum + i.bulkSavings, 0),
        tax,
        shipping,
        total: subtotal + shipping,
      },
      hasIssues: items.some((i) => i.issue),
    };
  },

  /** Public representation (drops the internal documents). */
  async get(userId) {
    const view = await this.view(userId);
    return { ...view, items: view.items.map(({ _product, _quote, _sellable, ...rest }) => rest) };
  },

  async setItem(userId, productId, quantity, variantId) {
    const quoted = await Cart.exists({ user: userId, items: { $elemMatch: { product: productId, quote: { $exists: true } } } });
    if (quoted) {
      throw ApiError.conflict('This item is in your cart at a quoted price. Remove it first to buy at the listed price.', {
        code: 'QUOTED_ITEM_IN_CART',
      });
    }
    await assertOrderable(productId, quantity, variantId);
    const match = lineMatch(productId, variantId);
    const updated = await Cart.findOneAndUpdate(
      { user: userId, items: { $elemMatch: match } },
      { $set: { 'items.$.quantity': quantity } },
      { returnDocument: 'after' },
    );
    if (!updated) {
      const cart = await ensureCart(userId);
      if (cart.items.length >= MAX_CART_ITEMS) throw ApiError.unprocessable(`Your cart can hold up to ${MAX_CART_ITEMS} different items`);
      await Cart.updateOne(
        { user: userId, items: { $not: { $elemMatch: match } } },
        { $push: { items: { product: productId, ...(variantId ? { variant: variantId } : {}), quantity } } },
      );
    }
    return this.get(userId);
  },

  /** Puts an accepted quote in the cart, replacing any regular line for the same product. */
  async addQuote(userId, quote) {
    const cart = await ensureCart(userId);
    const others = cart.items.filter((i) => String(i.product) !== String(quote.product));
    if (others.length >= MAX_CART_ITEMS) throw ApiError.unprocessable(`Your cart can hold up to ${MAX_CART_ITEMS} different items`);
    await Cart.updateOne({ user: userId }, { $pull: { items: { product: quote.product } } });
    await Cart.updateOne({ user: userId }, { $push: { items: { product: quote.product, quantity: quote.quantity, quote: quote._id } } });
    return this.get(userId);
  },

  async removeItem(userId, productId, variantId) {
    await Cart.updateOne({ user: userId }, { $pull: { items: lineMatch(productId, variantId) } });
    return this.get(userId);
  },

  /** Merges a guest (localStorage) cart after sign-in. Invalid lines are skipped, not fatal. */
  async merge(userId, lines) {
    for (const { productId, variantId, quantity } of lines.slice(0, MAX_CART_ITEMS)) {
      const product = await Product.findOne({ _id: productId, ...VISIBLE })
        .select(PRICING_FIELDS)
        .lean();
      const sellable = sellableOrNull(product, variantId);
      if (!sellable || sellable.available <= 0) continue;
      const qty = Math.max(product.inventory.moq, Math.min(quantity, maxOrderable(product, sellable)));
      await this.setItem(userId, productId, qty, variantId).catch(() => {});
    }
    return this.get(userId);
  },

  async removeProducts(userId, productIds) {
    await Cart.updateOne({ user: userId }, { $pull: { items: { product: { $in: productIds } } } });
  },

  /** Drops lines tied to quotes that are no longer usable (expired, withdrawn...). */
  async removeQuotes(quoteIds) {
    if (!quoteIds.length) return;
    await Cart.updateMany({ 'items.quote': { $in: quoteIds } }, { $pull: { items: { quote: { $in: quoteIds } } } });
  },
};
