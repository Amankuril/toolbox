import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cart } from '#modules/cart/cart.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let sellerA;
let sellerB;
let drill; // seller A
let saw; // seller B
let buyer;
let buyer2;

const A = () => bearer(sellerA.accessToken);
const B = () => bearer(sellerB.accessToken);
const U = () => bearer(buyer.accessToken);

async function product(seller, cat, name, price) {
  return (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(seller.accessToken))
      .send({
        type: 'tool',
        name,
        category: cat._id,
        pricing: { mrp: price + 50_000, price, gstRate: 18 },
        inventory: { stock: 50, moq: 1 },
        hsnCode: '8467',
        publish: true,
      })
      .expect(201)
  ).body.data;
}

/** Moves a cart's last activity into the past without it counting as activity. */
const ageCart = (userId, ms) => Cart.updateOne({ user: userId }, { $set: { updatedAt: new Date(Date.now() - ms) } }, { timestamps: false });

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  sellerA = await approvedVendor(app, admin.accessToken, { phone: '9600000001', storeName: 'Arihant Trading' });
  sellerB = await approvedVendor(app, admin.accessToken, {
    phone: '9600000002',
    storeName: 'Beta Tools',
    gstin: '29AABCB1234C1Z5',
    pan: 'AABCB1234C',
  });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Power Tools' }).expect(201))
    .body.data;
  drill = await product(sellerA, cat, 'Arihant Rotary Hammer', 710_000);
  saw = await product(sellerB, cat, 'Beta Mitre Saw', 300_000);

  buyer = await otpSignIn(app, { phone: '9600000099', audience: 'user', register: { name: 'Nand Lal Dhiman' } });
  buyer2 = await otpSignIn(app, { phone: '9600000098', audience: 'user', register: { name: 'Window Shopper' } });
  await request(app)
    .post(`${API}/user/addresses`)
    .set(U())
    .send({ name: 'Nand', phone: '9600000099', line1: '22 Secret Street', city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001' })
    .expect(201);
  await request(app).put(`${API}/user/cart/items/${drill._id}`).set(U()).send({ quantity: 1 }).expect(200);
  await request(app).put(`${API}/user/cart/items/${saw._id}`).set(U()).send({ quantity: 2 }).expect(200);
});
afterAll(stopTestApp);

describe('cart leads', () => {
  it("shows each seller only their own lines' value, as active while the buyer is shopping", async () => {
    const a = (await request(app).get(`${API}/vendor/leads/carts?tab=active`).set(A()).expect(200)).body.data;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      customer: { name: 'Nand Lal Dhiman', phone: '+919600000099' },
      value: 710_000,
      itemCount: 1,
      lastContact: null,
    });
    const b = (await request(app).get(`${API}/vendor/leads/carts?tab=active`).set(B()).expect(200)).body.data;
    expect(b[0]).toMatchObject({ value: 600_000, itemCount: 2 });
    expect((await request(app).get(`${API}/vendor/leads/carts?tab=abandoned`).set(A()).expect(200)).body.data).toHaveLength(0);
  });

  it('moves carts idle for over an hour to abandoned, and finds them by mobile number', async () => {
    await ageCart(buyer.account._id, 2 * 60 * 60_000);
    const counts = (await request(app).get(`${API}/vendor/leads/counts`).set(A()).expect(200)).body.data;
    expect(counts).toEqual({ abandoned: 1, active: 0, whatsapp: 0 });
    expect((await request(app).get(`${API}/vendor/leads/carts?tab=abandoned&q=9600000099`).set(A()).expect(200)).body.data).toHaveLength(1);
    expect((await request(app).get(`${API}/vendor/leads/carts?tab=abandoned&q=nobody`).set(A()).expect(200)).body.data).toHaveLength(0);
  });

  it("opens a lead with the seller's side of the cart and only the buyer's area", async () => {
    const lead = (await request(app).get(`${API}/vendor/leads/customers/${buyer.account._id}`).set(A()).expect(200)).body.data;
    expect(lead.status).toBe('abandoned');
    expect(lead.cart.items.map((i) => i.name)).toEqual(['Arihant Rotary Hammer']);
    expect(lead.cart).toMatchObject({ subtotal: 710_000, itemCount: 1 });
    expect(lead.area).toEqual({ city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001' });
    expect(JSON.stringify(lead)).not.toContain('Secret Street');
    expect(lead.canContact).toBe(true);
  });

  it("refuses buyers who aren't this seller's lead", async () => {
    await request(app).get(`${API}/vendor/leads/customers/${buyer2.account._id}`).set(A()).expect(404);
    await request(app)
      .post(`${API}/vendor/leads/customers/${buyer2.account._id}/contact`)
      .set(A())
      .send({ channel: 'whatsapp' })
      .expect(404);
  });
});

describe('contacting a lead', () => {
  it('builds a WhatsApp cart reminder and records it', async () => {
    const res = (
      await request(app)
        .post(`${API}/vendor/leads/customers/${buyer.account._id}/contact`)
        .set(A())
        .send({ channel: 'whatsapp' })
        .expect(200)
    ).body.data;
    expect(res.kind).toBe('cart_reminder');
    expect(res.url.startsWith('https://api.whatsapp.com/send?phone=919600000099&text=')).toBe(true);
    const text = decodeURIComponent(res.url.split('&text=')[1]);
    expect(text).toBe(res.message);
    expect(text).toContain('Greetings from Arihant Trading');
    expect(text).toContain('🛒');
    expect(text).toContain('/cart');

    const row = (await request(app).get(`${API}/vendor/leads/carts?tab=abandoned`).set(A()).expect(200)).body.data[0];
    expect(row.lastContact).toMatchObject({ channel: 'whatsapp' });
  });

  it('builds an SMS link with plain text', async () => {
    const res = (
      await request(app).post(`${API}/vendor/leads/customers/${buyer.account._id}/contact`).set(A()).send({ channel: 'sms' }).expect(200)
    ).body.data;
    expect(res.url.startsWith('sms:+919600000099?body=')).toBe(true);
    expect(res.message).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("shares one of the seller's own coupons, never another seller's", async () => {
    const mine = (
      await request(app)
        .post(`${API}/vendor/coupons`)
        .set(A())
        .send({ code: 'HAMMER5', type: 'percent', value: 5, maxDiscount: 50_000, description: 'on rotary hammers' })
        .expect(201)
    ).body.data;
    const theirs = (
      await request(app).post(`${API}/vendor/coupons`).set(B()).send({ code: 'BETA100', type: 'flat', value: 10_000 }).expect(201)
    ).body.data;
    const res = (
      await request(app)
        .post(`${API}/vendor/leads/customers/${buyer.account._id}/contact`)
        .set(A())
        .send({ channel: 'whatsapp', couponId: mine._id })
        .expect(200)
    ).body.data;
    expect(res.kind).toBe('offer');
    expect(res.message).toContain('Use code HAMMER5');
    expect(res.message).toContain('5% off (up to ₹500)');
    await request(app)
      .post(`${API}/vendor/leads/customers/${buyer.account._id}/contact`)
      .set(A())
      .send({ channel: 'whatsapp', couponId: theirs._id })
      .expect(404);

    const lead = (await request(app).get(`${API}/vendor/leads/customers/${buyer.account._id}`).set(A()).expect(200)).body.data;
    expect(lead.contacts.map((c) => c.kind)).toEqual(['offer', 'cart_reminder', 'cart_reminder']);
    expect(lead.contacts[0].couponCode).toBe('HAMMER5');
  });
});

describe('WhatsApp leads', () => {
  it('offers chat on product pages, records the tap as a lead, and uses the store WhatsApp number when set', async () => {
    const page = (await request(app).get(`${API}/public/products/${drill.slug}`).expect(200)).body.data;
    expect(page.product.vendor.chat).toBe(true);
    expect(JSON.stringify(page.product.vendor)).not.toContain('9600000001');

    await request(app).post(`${API}/user/whatsapp-chat`).send({ productId: drill._id }).expect(401);
    const B2 = bearer(buyer2.accessToken);
    const first = (await request(app).post(`${API}/user/whatsapp-chat`).set(B2).send({ productId: drill._id }).expect(200)).body.data;
    expect(first.url.startsWith('https://api.whatsapp.com/send?phone=919600000001&text=')).toBe(true);
    expect(decodeURIComponent(first.url)).toContain('Arihant Rotary Hammer');

    await request(app).patch(`${API}/vendor/me`).set(A()).send({ whatsapp: '9811122233' }).expect(200);
    const second = (await request(app).post(`${API}/user/whatsapp-chat`).set(B2).send({ productId: drill._id }).expect(200)).body.data;
    expect(second.url.startsWith('https://api.whatsapp.com/send?phone=919811122233&text=')).toBe(true);

    const rows = (await request(app).get(`${API}/vendor/leads/whatsapp`).set(A()).expect(200)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer: { name: 'Window Shopper' }, clicks: 2, products: [{ name: 'Arihant Rotary Hammer' }] });
    expect((await request(app).get(`${API}/vendor/leads/whatsapp`).set(B()).expect(200)).body.data).toHaveLength(0);

    // A WhatsApp lead without a cart gets a follow-up about the product they asked about.
    const lead = (await request(app).get(`${API}/vendor/leads/customers/${buyer2.account._id}`).set(A()).expect(200)).body.data;
    expect(lead).toMatchObject({ status: null, cart: null, whatsapp: { clicks: 2 } });
    const res = (
      await request(app)
        .post(`${API}/vendor/leads/customers/${buyer2.account._id}/contact`)
        .set(A())
        .send({ channel: 'whatsapp' })
        .expect(200)
    ).body.data;
    expect(res.kind).toBe('follow_up');
    expect(res.message).toContain('You were looking at Arihant Rotary Hammer');
  });
});

describe('house store', () => {
  it('has leads under Our store, and the admin panel itself does not', async () => {
    await request(app).get(`${API}/admin/store/leads/counts`).set(bearer(admin.accessToken)).expect(200);
    await request(app).get(`${API}/admin/store/coupons`).set(bearer(admin.accessToken)).expect(200);
    await request(app).get(`${API}/admin/leads/counts`).set(bearer(admin.accessToken)).expect(404);
  });
});
