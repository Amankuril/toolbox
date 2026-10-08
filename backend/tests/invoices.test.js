import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { amountInWords, financialYear, partyStateCode, stateCode } from '#core/utils/gst.js';
import { Invoice } from '#modules/invoices/invoice.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let alpha; // Maharashtra seller (GSTIN 27…), same state as the buyer
let beta; // Karnataka seller (GSTIN 29…)
let drill;
let wrench;
let saw;
let buyer;
let other;
let addressId;

const FY = financialYear();

async function product(seller, cat, name, price, gstRate = 18) {
  return (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(seller.accessToken))
      .send({
        type: 'tool',
        name,
        category: cat._id,
        pricing: { mrp: price + 50_000, price, gstRate },
        inventory: { stock: 50, moq: 1 },
        hsnCode: '8467',
        publish: true,
      })
      .expect(201)
  ).body.data;
}

async function order(lines) {
  for (const [p, quantity] of lines)
    await request(app).put(`${API}/user/cart/items/${p._id}`).set(bearer(buyer.accessToken)).send({ quantity }).expect(200);
  return (
    await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(bearer(buyer.accessToken))
      .send({ addressId, paymentMethod: 'cod' })
      .expect(201)
  ).body.data.order;
}

async function ship(seller, o, itemIds) {
  for (const itemId of itemIds) {
    for (const status of ['confirmed', 'shipped']) {
      await request(app)
        .patch(`${API}/vendor/orders/${o._id}/items/${itemId}`)
        .set(bearer(seller.accessToken))
        .send({ status })
        .expect(200);
    }
  }
}

const itemsOf = (o, p) => o.items.filter((i) => String(i.product) === String(p._id)).map((i) => i._id);

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  alpha = await approvedVendor(app, admin.accessToken, { phone: '9700000001', storeName: 'Alpha Tools' });
  beta = await approvedVendor(app, admin.accessToken, {
    phone: '9700000002',
    storeName: 'Beta Machines',
    gstin: '29AABCB1234C1Z5',
    pan: 'AABCB1234C',
  });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Power Tools' }).expect(201))
    .body.data;
  drill = await product(alpha, cat, 'Alpha Hammer Drill', 590_000);
  wrench = await product(alpha, cat, 'Alpha Torque Wrench', 118_000, 12);
  saw = await product(beta, cat, 'Beta Mitre Saw', 236_000);

  buyer = await otpSignIn(app, { phone: '9700000099', audience: 'user', register: { name: 'Invoice Buyer' } });
  other = await otpSignIn(app, { phone: '9700000098', audience: 'user', register: { name: 'Someone Else' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(bearer(buyer.accessToken))
      .send({ name: 'Invoice Buyer', phone: '9700000099', line1: 'Plot 4, MIDC', city: 'Pune', state: 'Maharashtra', pincode: '411001' })
      .expect(201)
  ).body.data[0]._id;
  await settingsService.update('payments', { codEnabled: true }, { kind: 'system' });
  await settingsService.update('shipping', { flatFee: 11_800, freeAbove: 0 }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('GST helpers', () => {
  it('writes amounts in Indian words and knows financial years and state codes', () => {
    expect(amountInWords(123_450)).toBe('Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only');
    expect(amountInWords(1_234_567_800)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
    expect(financialYear(new Date('2026-03-31T10:00:00Z'))).toBe('25-26');
    expect(financialYear(new Date('2026-03-31T20:00:00Z'))).toBe('26-27'); // already 1 April in India
    expect(stateCode('Tamil Nadu')).toBe('33');
    expect(stateCode('orissa')).toBe('21');
    expect(partyStateCode({ gstin: '29AABCB1234C1Z5', state: 'Maharashtra' })).toBe('29');
  });
});

describe('seller invoices', () => {
  let first;

  it('waits until the seller ships, then issues a numbered invoice for their lines', async () => {
    first = await order([
      [drill, 1],
      [saw, 1],
    ]);
    const before = (await request(app).get(`${API}/user/orders/${first._id}/invoices`).set(bearer(buyer.accessToken)).expect(200)).body
      .data;
    expect(before.map((i) => i.status)).toEqual(['awaiting_shipment', 'awaiting_shipment']);
    const early = await request(app).get(`${API}/vendor/orders/${first._id}/invoice/pdf`).set(bearer(alpha.accessToken)).expect(409);
    expect(early.body.error.code).toBe('INVOICE_NOT_READY');

    await ship(alpha, first, itemsOf(first, drill));
    const mine = (await request(app).get(`${API}/vendor/orders/${first._id}/invoice`).set(bearer(alpha.accessToken)).expect(200)).body.data;
    expect(mine).toMatchObject({ status: 'issued', number: `ALPH/${FY}/0001`, total: 590_000 + 11_800 });
  });

  it('splits GST as CGST + SGST within a state and carries the delivery charge on the first seller', async () => {
    const inv = await Invoice.findOne({ order: first._id, vendor: alpha.account._id }).lean();
    expect(inv.interState).toBe(false);
    expect(inv.placeOfSupply).toBe('Maharashtra (27)');
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({
      name: 'Alpha Hammer Drill',
      quantity: 1,
      amount: 590_000,
      taxable: 500_000,
      tax: 90_000,
      gstRate: 18,
    });
    expect(inv.shipping).toEqual({ amount: 11_800, taxable: 10_000, gstRate: 18, tax: 1_800 });
    expect(inv.totals).toMatchObject({ taxable: 510_000, cgst: 45_900, sgst: 45_900, igst: 0, total: 601_800 });
  });

  it('uses IGST across states, and its own series per seller', async () => {
    await ship(beta, first, itemsOf(first, saw));
    const inv = await Invoice.findOne({ order: first._id, vendor: beta.account._id }).lean();
    expect(inv.number).toBe(`BETA/${FY}/0001`);
    expect(inv.interState).toBe(true);
    expect(inv.shipping).toBeUndefined();
    expect(inv.totals).toMatchObject({ taxable: 200_000, cgst: 0, sgst: 0, igst: 36_000, total: 236_000 });
  });

  it('leaves cancelled lines off, and numbers the next invoice in sequence', async () => {
    const second = await order([
      [drill, 1],
      [wrench, 2],
    ]);
    await request(app)
      .post(`${API}/user/orders/${second._id}/items/${itemsOf(second, wrench)[0]}/cancel`)
      .set(bearer(buyer.accessToken))
      .send({})
      .expect(200);
    await ship(alpha, second, itemsOf(second, drill));
    const inv = await Invoice.findOne({ order: second._id, vendor: alpha.account._id }).lean();
    expect(inv.number).toBe(`ALPH/${FY}/0002`);
    expect(inv.lines.map((l) => l.name)).toEqual(['Alpha Hammer Drill']);
  });

  it('serves the same PDF to the buyer, the seller and admins, and to nobody else', async () => {
    const res = await request(app)
      .get(`${API}/user/orders/${first._id}/invoices/${alpha.account._id}/pdf`)
      .set(bearer(buyer.accessToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`Invoice-ALPH-${FY}-0001.pdf`);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(5_000);

    await request(app).get(`${API}/vendor/orders/${first._id}/invoice/pdf`).set(bearer(alpha.accessToken)).expect(200);
    await request(app).get(`${API}/admin/orders/${first._id}/invoices/${beta.account._id}/pdf`).set(bearer(admin.accessToken)).expect(200);
    const all = (await request(app).get(`${API}/admin/orders/${first._id}/invoices`).set(bearer(admin.accessToken)).expect(200)).body.data;
    expect(all.map((i) => i.number)).toEqual([`ALPH/${FY}/0001`, `BETA/${FY}/0001`]);

    // Another buyer can't, and a seller only ever sees their own invoice.
    await request(app).get(`${API}/user/orders/${first._id}/invoices/${alpha.account._id}/pdf`).set(bearer(other.accessToken)).expect(404);
    const betaView = (await request(app).get(`${API}/vendor/orders/${first._id}/invoice`).set(bearer(beta.accessToken)).expect(200)).body
      .data;
    expect(betaView.number).toBe(`BETA/${FY}/0001`);
  });

  it('issues on first download for orders shipped before invoices existed', async () => {
    const legacy = await order([[saw, 1]]);
    await ship(beta, legacy, itemsOf(legacy, saw));
    await Invoice.deleteOne({ order: legacy._id });
    await request(app).get(`${API}/vendor/orders/${legacy._id}/invoice/pdf`).set(bearer(beta.accessToken)).expect(200);
    // 0002 went to the invoice this test deleted to simulate an older order.
    expect((await Invoice.findOne({ order: legacy._id }).lean()).number).toBe(`BETA/${FY}/0003`);
  });
});
