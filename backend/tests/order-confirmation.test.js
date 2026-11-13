import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmationService } from '#modules/invoices/confirmation.service.js';
import { Order } from '#modules/orders/order.model.js';
import { User } from '#modules/users/user.model.js';
import { mailService } from '#services/mail/mail.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let seller;
let tool;
let buyer;
let noEmail;
let addressFor;

const EMAIL = 'buyer@toolbox.test';

async function checkout(user) {
  await request(app).put(`${API}/user/cart/items/${tool._id}`).set(bearer(user.accessToken)).send({ quantity: 2 }).expect(200);
  return (
    await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(bearer(user.accessToken))
      .send({ addressId: addressFor.get(user), paymentMethod: 'cod' })
      .expect(201)
  ).body.data.order;
}

/** Checkout sends in the background; wait until it has settled. */
async function settled(orderId) {
  for (let n = 0; n < 50; n++) {
    const o = await Order.findById(orderId, 'confirmationEmail').lean();
    if (o.confirmationEmail?.status && o.confirmationEmail.status !== 'sending') return o.confirmationEmail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('confirmation email never settled');
}

async function addAddress(user, phone) {
  return (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(bearer(user.accessToken))
      .send({ name: 'Ravi Kumar', phone, line1: 'Plot 4, MIDC', city: 'Pune', state: 'Maharashtra', pincode: '411001' })
      .expect(201)
  ).body.data[0]._id;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  seller = await approvedVendor(app, admin.accessToken, { phone: '9710000001', storeName: 'Confirm Tools' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Hand Tools' }).expect(201))
    .body.data;
  tool = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(seller.accessToken))
      .send({
        type: 'tool',
        name: 'Confirm Spanner Set',
        category: cat._id,
        pricing: { mrp: 150_000, price: 118_000, gstRate: 18 },
        inventory: { stock: 50, moq: 1 },
        hsnCode: '8204',
        publish: true,
      })
      .expect(201)
  ).body.data;

  buyer = await otpSignIn(app, { phone: '9710000099', audience: 'user', register: { name: 'Ravi Kumar' } });
  noEmail = await otpSignIn(app, { phone: '9710000098', audience: 'user', register: { name: 'No Email' } });
  await User.updateOne({ _id: buyer.account._id }, { email: EMAIL });
  addressFor = new Map([
    [buyer, await addAddress(buyer, '9710000099')],
    [noEmail, await addAddress(noEmail, '9710000098')],
  ]);
  await settingsService.update('payments', { codEnabled: true }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('order confirmation email', () => {
  let placed;

  it('emails the buyer with the confirmation PDF as soon as a COD order is placed, once', async () => {
    placed = await checkout(buyer);
    const email = await settled(placed._id);
    expect(email.status).toBe('sent');

    const message = mailService.provider.lastMessageTo(EMAIL);
    expect(message.subject).toContain(placed.orderNumber);
    expect(message.html).toContain('Confirm Spanner Set');
    const pdf = message.attachments.find((a) => a.contentType === 'application/pdf');
    expect(pdf.filename).toBe(`Order-${placed.orderNumber}.pdf`);
    expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');

    // Already sent: neither another call nor the sweeper sends it again.
    expect(await confirmationService.send(placed._id)).toBeNull();
    expect(await confirmationService.sweep()).toBe(0);
  });

  it('skips buyers without an email address', async () => {
    const o = await checkout(noEmail);
    const email = await settled(o._id);
    expect(email.status).toBe('skipped');
  });

  it('records a failed send and leaves it for the retry window', async () => {
    const real = mailService.provider;
    mailService.useProvider({
      name: 'broken',
      send: async () => {
        throw new Error('SMTP down');
      },
    });
    try {
      const o = await checkout(buyer);
      const email = await settled(o._id);
      expect(email.status).toBe('failed');
      expect(email.error).toContain('SMTP down');
      // Not due again until the retry window passes.
      expect(await confirmationService.send(o._id)).toBeNull();
    } finally {
      mailService.useProvider(real);
    }
  });

  it('lets the buyer and admins download the confirmation, and admins resend it', async () => {
    const res = await request(app)
      .get(`${API}/user/orders/${placed._id}/confirmation/pdf`)
      .set(bearer(buyer.accessToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`Order-${placed.orderNumber}.pdf`);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');

    await request(app).get(`${API}/user/orders/${placed._id}/confirmation/pdf`).set(bearer(noEmail.accessToken)).expect(404);
    await request(app).get(`${API}/admin/orders/${placed._id}/confirmation/pdf`).set(bearer(admin.accessToken)).expect(200);

    const detail = (await request(app).get(`${API}/user/orders/${placed._id}`).set(bearer(buyer.accessToken)).expect(200)).body.data;
    expect(detail.confirmationEmail.status).toBe('sent');

    const resent = (
      await request(app).post(`${API}/admin/orders/${placed._id}/confirmation/email`).set(bearer(admin.accessToken)).expect(200)
    ).body.data;
    expect(resent.status).toBe('sent');
  });
});
