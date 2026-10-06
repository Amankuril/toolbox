import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Order } from '#modules/orders/order.model.js';
import { orderService } from '#modules/orders/order.service.js';
import { Quote } from '#modules/quotes/quote.model.js';
import { quoteLifecycle } from '#modules/quotes/quote.lifecycle.js';
import { settingsService } from '#services/settings/settings.service.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import {
  API,
  approvedVendor,
  bearer,
  createAdmin,
  otpSignIn,
  setModeration,
  startTestApp,
  stopTestApp,
  testImage,
  upload,
} from './helpers.js';

let app;
let admin;
let vendor;
let category;
let product;
let shopper;
let business;
let shopperAddress;

const v = () => bearer(vendor.accessToken);
const s = () => bearer(shopper.accessToken);
const b = () => bearer(business.accessToken);

const baseProduct = (overrides = {}) => ({
  type: 'tool',
  name: 'Hex Bolt M10 x 50 (Zinc)',
  category: category._id,
  pricing: { mrp: 2_000, price: 1_500, gstRate: 18 },
  inventory: { stock: 2_000, moq: 5, unit: 'piece' },
  hsnCode: '8424',
  publish: true,
  ...overrides,
});

async function addAddress(token) {
  const res = await request(app)
    .post(`${API}/user/addresses`)
    .set(bearer(token))
    .send({ name: 'Buyer', phone: '9300000000', line1: 'Unit 3, Industrial Area', city: 'Rajkot', state: 'Gujarat', pincode: '360003' })
    .expect(201);
  return res.body.data[0]._id;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9300000001' });
  await setModeration({ autoApproveProducts: true });
  category = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Fasteners' }).expect(201))
    .body.data;
  shopper = await otpSignIn(app, { phone: '9300000010', audience: 'user', register: { name: 'Individual Buyer' } });
  business = await otpSignIn(app, {
    phone: '9300000011',
    audience: 'user',
    register: { name: 'Plant Buyer', accountType: 'business', businessName: 'Rajkot Castings' },
  });
  shopperAddress = await addAddress(shopper.accessToken);
});
afterAll(stopTestApp);

describe('bulk pricing tiers', () => {
  it('rejects tiers that do not step up in quantity and down in price', async () => {
    const bad = await request(app)
      .post(`${API}/vendor/products`)
      .set(v())
      .send(
        baseProduct({
          bulkPricing: {
            tiers: [
              { minQty: 5, price: 1_400 }, // not above MOQ
              { minQty: 50, price: 1_450 }, // price went up
            ],
          },
        }),
      )
      .expect(422);
    expect(bad.body.error.code).toBe('INVALID_BULK_PRICING');
    expect(bad.body.error.details.map((d) => d.path)).toEqual(['bulkPricing.tiers.0.minQty', 'bulkPricing.tiers.1.price']);

    const tooMany = await request(app)
      .post(`${API}/vendor/products`)
      .set(v())
      .send(baseProduct({ bulkPricing: { tiers: Array.from({ length: 6 }, (_, i) => ({ minQty: 10 * (i + 1), price: 1_400 - i * 10 })) } }))
      .expect(422);
    expect(tooMany.body.error.details[0].path).toBe('bulkPricing.tiers');
  });

  it('prices the cart from the deepest tier reached and records it on the order', async () => {
    product = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(v())
        .send(
          baseProduct({
            bulkPricing: {
              tiers: [
                { minQty: 50, price: 1_350 },
                { minQty: 200, price: 1_200 },
              ],
            },
          }),
        )
        .expect(201)
    ).body.data;
    expect(product.status).toBe('active');

    const card = (await request(app).get(`${API}/public/products?bulk=true`).expect(200)).body.data[0];
    expect(card.bulk).toMatchObject({ fromPrice: 1_200, startsAt: 50, businessOnly: false });

    let cart = (await request(app).put(`${API}/user/cart/items/${product._id}`).set(s()).send({ quantity: 40 }).expect(200)).body.data;
    expect(cart.items[0]).toMatchObject({
      unitPrice: 1_500,
      pricing: { source: 'base', next: { minQty: 50, price: 1_350, unitsNeeded: 10 } },
    });

    cart = (await request(app).put(`${API}/user/cart/items/${product._id}`).set(s()).send({ quantity: 120 }).expect(200)).body.data;
    expect(cart.items[0]).toMatchObject({ unitPrice: 1_350, bulkSavings: 150 * 120, pricing: { source: 'bulk', tier: { minQty: 50 } } });
    expect(cart.summary).toMatchObject({ subtotal: 1_350 * 120, bulkSavings: 18_000 });

    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(s()).send({ addressId: shopperAddress, paymentMethod: 'cod' }).expect(201)
    ).body.data;
    expect(order.items[0]).toMatchObject({ unitPrice: 1_350, basePrice: 1_500, pricing: { source: 'bulk', tierMinQty: 50 } });
    expect(order.amounts.subtotal).toBe(162_000);
  });

  it('keeps business-only tiers away from individual accounts', async () => {
    const p = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(v())
        .send(baseProduct({ name: 'Anchor Fastener 12mm', bulkPricing: { tiers: [{ minQty: 20, price: 1_100 }], businessOnly: true } }))
        .expect(201)
    ).body.data;

    const individual = (await request(app).put(`${API}/user/cart/items/${p._id}`).set(s()).send({ quantity: 25 }).expect(200)).body.data;
    expect(individual.items.find((i) => i.productId === p._id)).toMatchObject({
      unitPrice: 1_500,
      pricing: { source: 'base', next: null },
    });

    const biz = (await request(app).put(`${API}/user/cart/items/${p._id}`).set(b()).send({ quantity: 25 }).expect(200)).body.data;
    expect(biz.items[0]).toMatchObject({ unitPrice: 1_100, pricing: { source: 'bulk' } });
    await request(app).delete(`${API}/user/cart/items/${p._id}`).set(s()).expect(200);
    await request(app).delete(`${API}/user/cart/items/${p._id}`).set(b()).expect(200);
  });

  it('blocks a quick price cut that would put the base price under a tier', async () => {
    const res = await request(app)
      .patch(`${API}/vendor/products/${product._id}/stock`)
      .set(v())
      .send({ stock: 1_000, price: 1_300 })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_BULK_PRICING');
  });
});

describe('request for quote', () => {
  let quote;

  it('enforces the quote threshold and one open request per product', async () => {
    const small = await request(app)
      .post(`${API}/user/quotes`)
      .set(b())
      .send({ productId: product._id, quantity: 100, pincode: '360003' })
      .expect(422);
    expect(small.body.error.code).toBe('BELOW_QUOTE_THRESHOLD'); // threshold defaults to the top tier (200)

    quote = (
      await request(app)
        .post(`${API}/user/quotes`)
        .set(b())
        .send({
          productId: product._id,
          quantity: 5_000,
          targetUnitPrice: 1_000,
          pincode: '360003',
          note: 'Monthly requirement for our plant',
        })
        .expect(201)
    ).body.data;
    expect(quote).toMatchObject({ status: 'requested', quantity: 5_000, product: { name: 'Hex Bolt M10 x 50 (Zinc)', basePrice: 1_500 } });

    const dup = await request(app)
      .post(`${API}/user/quotes`)
      .set(b())
      .send({ productId: product._id, quantity: 6_000, pincode: '360003' })
      .expect(409);
    expect(dup.body.error.code).toBe('QUOTE_ALREADY_OPEN');
  });

  it('vendor sees the buyer business (not their phone) and sends an offer', async () => {
    const list = (await request(app).get(`${API}/vendor/quotes?status=requested`).set(v()).expect(200)).body;
    expect(list.meta.counts.requested).toBe(1);
    expect(list.data[0].buyer).toEqual({ name: 'Plant Buyer', accountType: 'business', businessName: 'Rajkot Castings', gstin: null });
    expect(JSON.stringify(list.data[0])).not.toContain('9300000011');

    const offered = (
      await request(app)
        .post(`${API}/vendor/quotes/${quote._id}/offer`)
        .set(v())
        .send({ unitPrice: 1_050, validDays: 7, note: 'Includes freight' })
        .expect(200)
    ).body.data;
    expect(offered).toMatchObject({ status: 'quoted', offer: { unitPrice: 1_050, revision: 0 } });
  });

  it('accepting locks the line in the cart at the quoted price; checkout consumes the quote', async () => {
    await request(app).patch(`${API}/vendor/products/${product._id}/stock`).set(v()).send({ stock: 10_000 }).expect(200);
    const { cart } = (await request(app).post(`${API}/user/quotes/${quote._id}/accept`).set(b()).expect(200)).body.data;
    const line = cart.items.find((i) => i.productId === product._id);
    expect(line).toMatchObject({ quantity: 5_000, quantityLocked: true, unitPrice: 1_050, pricing: { source: 'quote' } });

    const locked = await request(app).put(`${API}/user/cart/items/${product._id}`).set(b()).send({ quantity: 10 }).expect(409);
    expect(locked.body.error.code).toBe('QUOTED_ITEM_IN_CART');

    const address = await addAddress(business.accessToken);
    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(b()).send({ addressId: address, paymentMethod: 'cod' }).expect(201)
    ).body.data;
    expect(order.items[0]).toMatchObject({ unitPrice: 1_050, quantity: 5_000, pricing: { source: 'quote' } });
    expect((await Quote.findById(quote._id).lean()).status).toBe('ordered');
  });

  it('an online order that times out gives the quote back', async () => {
    paymentService.useRazorpay({
      ...createRazorpayProvider({ keyId: 'k', keySecret: 's', webhookSecret: 'w' }),
      createOrder: async ({ amount, currency }) => ({ providerOrderId: `order_${Date.now()}`, amount, currency }),
    });
    await settingsService.update('payments', { razorpayEnabled: true, codMaxOrderValue: 0 }, { kind: 'system' });

    const q = (
      await request(app)
        .post(`${API}/user/quotes`)
        .set(b())
        .send({ productId: product._id, quantity: 1_000, pincode: '360003' })
        .expect(201)
    ).body.data;
    await request(app).post(`${API}/vendor/quotes/${q._id}/offer`).set(v()).send({ unitPrice: 1_100, validDays: 3 }).expect(200);
    await request(app).post(`${API}/user/quotes/${q._id}/accept`).set(b()).expect(200);
    const address = (await request(app).get(`${API}/user/addresses`).set(b())).body.data[0]._id;
    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(b()).send({ addressId: address, paymentMethod: 'razorpay' }).expect(201)
    ).body.data;
    expect((await Quote.findById(q._id).lean()).status).toBe('ordered');

    // While the order waits for payment, the cart line can't be re-used.
    const cart = (await request(app).get(`${API}/user/cart`).set(b())).body.data;
    expect(cart.items.find((i) => i.pricing.quote?._id === q._id).issue).toBe('quote_in_order');

    await Order.updateOne({ _id: order._id }, { expiresAt: new Date(Date.now() - 1000) });
    await orderService.expireUnpaid();
    expect((await Quote.findById(q._id).lean()).status).toBe('accepted');
  });

  it('expired offers drop out of carts; vendors can decline', async () => {
    const q = await Quote.findOne({ status: 'accepted' });
    await Quote.updateOne({ _id: q._id }, { 'offer.validUntil': new Date(Date.now() - 1000) });
    let cart = (await request(app).get(`${API}/user/cart`).set(b())).body.data;
    expect(cart.items.find((i) => String(i.pricing.quote?._id) === String(q._id)).issue).toBe('quote_expired');

    expect(await quoteLifecycle.expireStale()).toBe(1);
    cart = (await request(app).get(`${API}/user/cart`).set(b())).body.data;
    expect(cart.items.some((i) => i.pricing.quote)).toBe(false);

    const req2 = (
      await request(app).post(`${API}/user/quotes`).set(s()).send({ productId: product._id, quantity: 300, pincode: '360003' }).expect(201)
    ).body.data;
    const declined = (
      await request(app)
        .post(`${API}/vendor/quotes/${req2._id}/decline`)
        .set(v())
        .send({ reason: 'Cannot supply in this lead time' })
        .expect(200)
    ).body.data;
    expect(declined).toMatchObject({ status: 'declined', declineReason: 'Cannot supply in this lead time' });
    await request(app).post(`${API}/user/quotes/${req2._id}/accept`).set(s()).expect(409);

    const adminList = (await request(app).get(`${API}/admin/quotes`).set(bearer(admin.accessToken)).expect(200)).body;
    expect(adminList.meta.total).toBe(3);
  });
});

describe('per-module branding', () => {
  it('stores a logo and a square favicon for each module separately', async () => {
    const a = bearer(admin.accessToken);
    const [favicon] = (await upload(app, admin.accessToken, 'favicons', [await testImage({ width: 600, height: 300 })]).expect(201)).body
      .data;
    expect(favicon).toMatchObject({ width: 256, height: 256 });
    const [logo] = (await upload(app, admin.accessToken, 'branding', [await testImage({ width: 1200, height: 300 })]).expect(201)).body
      .data;

    await request(app)
      .put(`${API}/admin/settings/branding`)
      .set(a)
      .send({ modules: { vendor: { logo: { media: logo._id }, favicon: { media: favicon._id } } } })
      .expect(200);
    const pub = (await request(app).get(`${API}/public/settings`)).body.data.branding;
    expect(pub.modules.vendor.logo.url).toBe(logo.url);
    expect(pub.modules.vendor.favicon.url).toBe(favicon.url);
    expect(pub.modules.user).toEqual({ logo: null, favicon: null });

    const img = await sharp(Buffer.from(await (await request(app).get(favicon.url)).body)).metadata();
    expect([img.width, img.height, img.format]).toEqual([256, 256, 'webp']);
  });
});
