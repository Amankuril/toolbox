import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let root;
let category;
let product;
const R = () => bearer(root.accessToken);

async function staff(email, permissions) {
  await request(app)
    .post(`${API}/admin/admins`)
    .set(R())
    .send({ name: 'Staff', email, password: 'Staff!pass123', role: 'admin', permissions })
    .expect(201);
  const res = await request(app).post(`${API}/auth/admin/login`).send({ email, password: 'Staff!pass123' }).expect(200);
  return bearer(res.body.data.accessToken);
}

beforeAll(async () => {
  app = await startTestApp();
  root = await createAdmin(app);
  await approvedVendor(app, root.accessToken, { phone: '9500000001' });
  // Other sellers still need review; the house store must not.
  await setModeration({ autoApproveProducts: false });
  category = (await request(app).post(`${API}/admin/categories`).set(R()).send({ name: 'Generators' }).expect(201)).body.data;
});
afterAll(stopTestApp);

describe('platform store', () => {
  it('exists on first use as "ToolsHubs Official", and the admin can rename it and set pickup details', async () => {
    const store = (await request(app).get(`${API}/admin/store/me`).set(R()).expect(200)).body.data;
    expect(store).toMatchObject({
      store: { name: 'ToolsHubs Official' },
      official: true,
      readyToShip: false,
      phone: null,
      status: 'approved',
    });

    const updated = (
      await request(app)
        .patch(`${API}/admin/store/me`)
        .set(R())
        .send({
          storeName: 'ToolsHubs Direct',
          phone: '9500000077',
          email: 'store@toolshubs.test',
          address: { line1: 'Gat 22, Chakan MIDC', city: 'Pune', state: 'Maharashtra', pincode: '410501' },
        })
        .expect(200)
    ).body.data;
    expect(updated).toMatchObject({
      store: { name: 'ToolsHubs Direct', slug: store.store.slug },
      phone: '+919500000077',
      readyToShip: true,
    });
  });

  it('publishes its products immediately, shown as the official store', async () => {
    product = (
      await request(app)
        .post(`${API}/admin/store/products`)
        .set(R())
        .send({
          type: 'machinery',
          name: 'Silent diesel generator 5 kVA',
          category: category._id,
          pricing: { mrp: 9_000_000, price: 8_500_000, gstRate: 18 },
          hsnCode: '8502',
          inventory: { stock: 5, moq: 1 },
          publish: true,
        })
        .expect(201)
    ).body.data;
    expect(product.status).toBe('active');
    const page = (await request(app).get(`${API}/public/products/${product.slug}`).expect(200)).body.data.product;
    expect(page.vendor).toMatchObject({ official: true, store: { name: 'ToolsHubs Direct' } });
    expect((await request(app).get(`${API}/admin/store/products`).set(R()).expect(200)).body.data).toHaveLength(1);
  });

  it('is not listed or managed as a seller, and nobody can sign in as it', async () => {
    const vendors = (await request(app).get(`${API}/admin/vendors`).set(R()).expect(200)).body.data;
    expect(vendors.some((v) => v.store.name === 'ToolsHubs Direct')).toBe(false);
    const vendorId = (await Product.findById(product._id).lean()).vendor;
    await request(app).post(`${API}/admin/vendors/${vendorId}/suspend`).set(R()).send({ note: 'x' }).expect(404);
    await expect(otpSignIn(app, { phone: '9500000077', audience: 'vendor' })).rejects.toThrow(/PLATFORM_STORE/);
  });

  it('takes orders that the admin accepts like a seller', async () => {
    const buyer = await otpSignIn(app, { phone: '9500000099', audience: 'user', register: { name: 'Ravi' } });
    const U = bearer(buyer.accessToken);
    const addressId = (
      await request(app)
        .post(`${API}/user/addresses`)
        .set(U)
        .send({ name: 'Ravi', phone: '9500000099', line1: 'Farm 3', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
        .expect(201)
    ).body.data[0]._id;
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(U).send({ quantity: 1 }).expect(200);
    const cart = (await request(app).get(`${API}/user/cart`).set(U).expect(200)).body.data;
    expect(Object.values(cart.sellers)[0]).toMatchObject({ name: 'ToolsHubs Direct', official: true });
    const order = (await request(app).post(`${API}/user/orders/checkout`).set(U).send({ addressId, paymentMethod: 'cod' }).expect(201)).body
      .data.order;

    const mine = (await request(app).get(`${API}/admin/store/orders`).set(R()).expect(200)).body.data;
    expect(mine.map((o) => o._id)).toContain(order._id);
    const accepted = (
      await request(app)
        .patch(`${API}/admin/store/orders/${order._id}/items/${order.items[0]._id}`)
        .set(R())
        .send({ status: 'confirmed' })
        .expect(200)
    ).body.data;
    expect(accepted.items[0].status).toBe('confirmed');
  });

  it('has every seller tool: dashboard, categories, bulk upload, export, quotes and shipments', async () => {
    for (const path of [
      '/dashboard',
      '/categories',
      '/products/compatibility-search?q=gen',
      '/product-imports',
      '/product-imports/columns',
      '/product-imports/template?format=xlsx',
      '/product-imports/categories.csv',
      '/product-imports/export?format=csv',
      '/quotes',
    ]) {
      await request(app).get(`${API}/admin/store${path}`).set(R()).expect(200);
    }
    const [order] = (await request(app).get(`${API}/admin/store/orders`).set(R()).expect(200)).body.data;
    await request(app).get(`${API}/admin/store/orders/${order._id}`).set(R()).expect(200);
    await request(app).get(`${API}/admin/store/orders/${order._id}/shipments`).set(R()).expect(200);
    // A category the store adds goes live at once (other sellers' proposals still wait for review).
    const cat = (
      await request(app).post(`${API}/admin/store/categories`).set(R()).send({ name: 'Inverters', parent: category._id }).expect(201)
    ).body.data;
    expect(cat.status).toBe('active');
  });

  it('sub-admins need the "Our store" permission; view-only can look but not change', async () => {
    const none = await staff('catalog@toolbox.test', { products: 'manage' });
    expect((await request(app).get(`${API}/admin/store/products`).set(none).expect(403)).body.error.code).toBe('PERMISSION_DENIED');

    const viewer = await staff('viewer@toolbox.test', { store: 'view' });
    await request(app).get(`${API}/admin/store/orders`).set(viewer).expect(200);
    await request(app).patch(`${API}/admin/store/me`).set(viewer).send({ storeName: 'Nope' }).expect(403);

    const manager = await staff('store@toolbox.test', { store: 'manage' });
    await request(app).patch(`${API}/admin/store/products/${product._id}/stock`).set(manager).send({ stock: 9 }).expect(200);
    // Store access alone doesn't open the rest of the admin panel.
    await request(app).get(`${API}/admin/vendors`).set(manager).expect(403);
  });
});
