import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;
let buyer;
let other;
let product;

async function deliveredOrder(customer) {
  const U = bearer(customer.accessToken);
  const addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U)
      .send({ name: 'Buyer', phone: '9700000099', line1: 'Gat 1', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
      .expect(201)
  ).body.data[0]._id;
  await request(app).put(`${API}/user/cart/items/${product._id}`).set(U).send({ quantity: 1 }).expect(200);
  const order = (await request(app).post(`${API}/user/orders/checkout`).set(U).send({ addressId, paymentMethod: 'cod' }).expect(201)).body
    .data.order;
  const V = bearer(vendor.accessToken);
  for (const status of ['confirmed', 'shipped', 'delivered']) {
    await request(app).patch(`${API}/vendor/orders/${order._id}/items/${order.items[0]._id}`).set(V).send({ status }).expect(200);
  }
  return order;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9700000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Mops' }).expect(201)).body
    .data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'tool',
        name: 'Heavy Duty Mop Wringer Trolley 20L',
        category: cat._id,
        pricing: { mrp: 300_000, price: 250_000, gstRate: 18 },
        hsnCode: '9603',
        inventory: { stock: 20, moq: 1 },
        publish: true,
      })
      .expect(201)
  ).body.data;
  buyer = await otpSignIn(app, { phone: '9700000002', audience: 'user', register: { name: 'Pradip Kumar Panigrahi' } });
  other = await otpSignIn(app, { phone: '9700000003', audience: 'user', register: { name: 'Bessy Parakkal' } });
});
afterAll(stopTestApp);

describe('reviews', () => {
  it('only customers who received the item can review it', async () => {
    const mine = (await request(app).get(`${API}/user/products/${product._id}/review`).set(bearer(buyer.accessToken)).expect(200)).body
      .data;
    expect(mine).toEqual({ review: null, canReview: false });
    const res = await request(app)
      .put(`${API}/user/products/${product._id}/review`)
      .set(bearer(buyer.accessToken))
      .send({ rating: 5 })
      .expect(403);
    expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
  });

  it('publishes verified reviews, keeps one per customer, and keeps the product rating in sync', async () => {
    await deliveredOrder(buyer);
    await deliveredOrder(other);
    const B = bearer(buyer.accessToken);
    expect((await request(app).get(`${API}/user/products/${product._id}/review`).set(B).expect(200)).body.data.canReview).toBe(true);

    await request(app).put(`${API}/user/products/${product._id}/review`).set(B).send({ rating: 4, title: 'Good' }).expect(200);
    // Editing replaces the same review rather than adding a second one.
    await request(app)
      .put(`${API}/user/products/${product._id}/review`)
      .set(B)
      .send({ rating: 5, title: 'Excellent product', body: 'Sturdy wheels.' })
      .expect(200);
    await request(app)
      .put(`${API}/user/products/${product._id}/review`)
      .set(bearer(other.accessToken))
      .send({ rating: 4, title: 'Good' })
      .expect(200);

    const list = (await request(app).get(`${API}/public/products/${product._id}/reviews`).expect(200)).body;
    expect(list.data.summary).toEqual({ average: 4.5, count: 2, breakdown: [0, 0, 0, 1, 1] });
    expect(list.data.items.map((r) => r.author).sort()).toEqual(['Bessy P.', 'Pradip P.']);
    expect(list.data.items[0]).toMatchObject({ verified: true });
    expect(list.data.items[0]).not.toHaveProperty('user');
    expect(list.data.items[0].purchasedAt).toBeTruthy();

    const card = (await request(app).get(`${API}/public/products?ids=${product._id}`).expect(200)).body.data[0];
    expect(card.rating).toEqual({ average: 4.5, count: 2 });
    const top = (await request(app).get(`${API}/public/products/${product._id}/reviews?rating=5`).expect(200)).body.data.items;
    expect(top).toHaveLength(1);
  });

  it('lets an admin hide a review, which drops it from the page and the rating', async () => {
    const A = bearer(admin.accessToken);
    const all = (await request(app).get(`${API}/admin/reviews`).set(A).expect(200)).body.data;
    const four = all.find((r) => r.rating === 4);
    expect(four.user.name).toBe('Bessy Parakkal');
    await request(app).patch(`${API}/admin/reviews/${four._id}`).set(A).send({ status: 'hidden', note: 'Off-topic' }).expect(200);

    const list = (await request(app).get(`${API}/public/products/${product._id}/reviews`).expect(200)).body.data;
    expect(list.summary).toMatchObject({ average: 5, count: 1 });
    expect((await Product.findById(product._id).lean()).rating.count).toBe(1);
    await request(app).get(`${API}/admin/reviews`).set(bearer(buyer.accessToken)).expect(401);
  });

  it('deletes your own review', async () => {
    await request(app).delete(`${API}/user/products/${product._id}/review`).set(bearer(buyer.accessToken)).expect(204);
    expect((await request(app).get(`${API}/public/products/${product._id}/reviews`).expect(200)).body.data.summary.count).toBe(0);
  });

  it('serves live store stats and hides numbers too small to reassure', async () => {
    const stats = (await request(app).get(`${API}/public/stats`).expect(200)).body.data;
    expect(stats).toEqual({ products: null, sellers: null, customers: null });
  });
});
