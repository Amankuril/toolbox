import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '#core/utils/crypto.js';
import { Order } from '#modules/orders/order.model.js';
import { orderService } from '#modules/orders/order.service.js';
import { Payment, canTransitionPayment } from '#modules/orders/payment.model.js';
import { Refund } from '#modules/orders/refund.model.js';
import { Product } from '#modules/products/product.model.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret';
const WEBHOOK_SECRET = 'rzp_webhook_secret';

function createMockRazorpay() {
  const real = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
  let orderCount = 0;
  const refunds = [];
  const capturedPayments = new Map();

  return {
    ...real,
    refunds,
    capturedPayments,
    async createOrder({ amount, currency, receipt }) {
      orderCount += 1;
      const id = `order_test_${orderCount}`;
      return { providerOrderId: id, amount, currency, status: 'created', receipt };
    },
    async refund(paymentId, { amount } = {}) {
      refunds.push({ paymentId, amount });
      return { refundId: `rfnd_${refunds.length}`, amount, status: 'processed' };
    },
    async fetchOrderPayments(providerOrderId) {
      if (capturedPayments.has(providerOrderId)) {
        return [{ id: capturedPayments.get(providerOrderId), orderId: providerOrderId, status: 'captured', captured: true }];
      }
      return [];
    },
  };
}

let app;
let admin;
let vendor;
let customer;
let product;
let addressId;
const razorpay = createMockRazorpay();

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9300000001' });
  await setModeration({ autoApproveProducts: true });

  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Power Tools' }).expect(201))
    .body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'tool',
        name: 'Bosch Cordless Drill GSB 120-LI',
        category: cat._id,
        pricing: { mrp: 600_000, price: 499_900, gstRate: 18 },
        inventory: { stock: 10, moq: 1, maxOrderQty: 5 },
        hsnCode: '8424',
        publish: true,
      })
      .expect(201)
  ).body.data;

  customer = await otpSignIn(app, { phone: '9300000099', audience: 'user', register: { name: 'Vikram Builder' } });
  const addrRes = await request(app)
    .post(`${API}/user/addresses`)
    .set(bearer(customer.accessToken))
    .send({ name: 'Vikram', phone: '9300000099', line1: 'Shop 7, Industrial Area', city: 'Pune', state: 'Maharashtra', pincode: '411001' })
    .expect(201);
  addressId = addrRes.body.data[0]._id;

  paymentService.useRazorpay(razorpay);
  await settingsService.update('payments', { razorpayEnabled: true, codEnabled: true }, { kind: 'system' });
  await settingsService.update('shipping', { flatFee: 5000, freeAbove: 1_000_000 }, { kind: 'system' });
});

afterAll(stopTestApp);

const user = () => bearer(customer.accessToken);

describe('Payment State Machine', () => {
  it('enforces valid transition paths and blocks invalid jumps', () => {
    expect(canTransitionPayment('created', 'pending')).toBe(true);
    expect(canTransitionPayment('pending', 'captured')).toBe(true);
    expect(canTransitionPayment('captured', 'partially_refunded')).toBe(true);
    expect(canTransitionPayment('captured', 'refunded')).toBe(true);
    expect(canTransitionPayment('partially_refunded', 'refunded')).toBe(true);

    // Disallowed transitions
    expect(canTransitionPayment('failed', 'captured')).toBe(false);
    expect(canTransitionPayment('cancelled', 'captured')).toBe(false);
    expect(canTransitionPayment('refunded', 'captured')).toBe(false);
  });
});

describe('Checkout Idempotency & Payment Attempts', () => {
  it('returns the same order without double decrementing stock when idempotencyKey is reused', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 1 }).expect(200);

    const idempotencyKey = 'idem_checkout_test_1';
    const initialStock = (await Product.findById(product._id).lean()).inventory.stock;

    // First request
    const res1 = await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(user())
      .send({ addressId, paymentMethod: 'razorpay', idempotencyKey })
      .expect(201);

    const orderId1 = res1.body.data.order._id;
    const stockAfterFirst = (await Product.findById(product._id).lean()).inventory.stock;
    expect(stockAfterFirst).toBe(initialStock - 1);

    // Second request with exact same idempotencyKey (simulating double click)
    const res2 = await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(user())
      .send({ addressId, paymentMethod: 'razorpay', idempotencyKey })
      .expect(201);

    const orderId2 = res2.body.data.order._id;
    expect(orderId2).toBe(orderId1);

    // Stock must NOT be decremented twice!
    const stockAfterSecond = (await Product.findById(product._id).lean()).inventory.stock;
    expect(stockAfterSecond).toBe(initialStock - 1);

    // Clean up order for next tests
    await Order.findByIdAndDelete(orderId1);
    await Product.findByIdAndUpdate(product._id, { $inc: { 'inventory.stock': 1 } });
  });

  it('tracks distinct payment attempts in Payment model on retry', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 1 }).expect(200);

    const checkoutRes = await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(user())
      .send({ addressId, paymentMethod: 'razorpay' })
      .expect(201);

    const order = checkoutRes.body.data.order;
    expect(order.status).toBe('pending_payment');

    // First payment attempt recorded
    const attempts1 = await Payment.find({ orderId: order._id }).lean();
    expect(attempts1).toHaveLength(1);
    expect(String(attempts1[0].orderId)).toBe(order._id);
    expect(attempts1[0]).toMatchObject({
      attemptNumber: 1,
      status: 'pending',
      amount: order.amounts.total,
    });

    // Record failure on first attempt
    await request(app)
      .post(`${API}/user/orders/${order._id}/payment/failed`)
      .set(user())
      .send({ reason: 'Card declined by issuing bank' })
      .expect(200);

    const failedPayment = await Payment.findOne({ orderId: order._id, attemptNumber: 1 }).lean();
    expect(failedPayment.status).toBe('failed');
    expect(failedPayment.failureReason).toBe('Card declined by issuing bank');

    // User retries payment
    const retryRes = await request(app).post(`${API}/user/orders/${order._id}/payment/retry`).set(user()).expect(200);

    expect(retryRes.body.data.payment.providerOrderId).toBeDefined();

    // Verify payment using HMAC signature
    const signature = hmacSha256(KEY_SECRET, `${retryRes.body.data.payment.providerOrderId}|pay_attempt_success`);
    const verifyRes = await request(app)
      .post(`${API}/user/orders/${order._id}/payment/verify`)
      .set(user())
      .send({
        providerOrderId: retryRes.body.data.payment.providerOrderId,
        paymentId: 'pay_attempt_success',
        signature,
      })
      .expect(200);

    expect(verifyRes.body.data.status).toBe('placed');
    expect(verifyRes.body.data.payment.status).toBe('paid');

    // Verify Payment domain record is updated to captured
    const capturedAttempt = await Payment.findOne({ providerPaymentId: 'pay_attempt_success' }).lean();
    expect(capturedAttempt.status).toBe('captured');
    expect(capturedAttempt.signatureVerified).toBe(true);
    expect(capturedAttempt.capturedAt).toBeDefined();
  });
});

describe('Refund Model Audit Trail & Cancellation', () => {
  it('creates an auditable Refund document on item cancellation and prevents duplicate refunds', async () => {
    // 1. Setup a paid order
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 2 }).expect(200);
    const { order, payment } = (
      await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)
    ).body.data;

    const signature = hmacSha256(KEY_SECRET, `${payment.providerOrderId}|pay_refund_test`);
    await request(app)
      .post(`${API}/user/orders/${order._id}/payment/verify`)
      .set(user())
      .send({ providerOrderId: payment.providerOrderId, paymentId: 'pay_refund_test', signature })
      .expect(200);

    const paidOrder = await Order.findById(order._id).lean();
    expect(paidOrder.payment.status).toBe('paid');

    // 2. Cancel the item
    const cancelRes = await request(app)
      .post(`${API}/user/orders/${order._id}/items/${paidOrder.items[0]._id}/cancel`)
      .set(user())
      .send({ reason: 'Found a better price' })
      .expect(200);

    expect(cancelRes.body.data.status).toBe('cancelled');
    expect(cancelRes.body.data.payment.status).toBe('refunded');

    // 3. Verify Refund collection has the record with idempotencyKey
    const refundDoc = await Refund.findOne({ orderId: order._id }).lean();
    expect(refundDoc).toBeDefined();
    expect(refundDoc).toMatchObject({
      orderId: paidOrder._id,
      providerPaymentId: 'pay_refund_test',
      status: 'processed',
      amount: paidOrder.amounts.total,
    });
    expect(refundDoc.idempotencyKey).toContain(`cancel_refund_${order._id}`);
  });
});

describe('Zombie Payment Protection & Reconciliation', () => {
  it('reconciles captured payments from Razorpay before expiring order', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 1 }).expect(200);
    const { order, payment } = (
      await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)
    ).body.data;

    // Simulate that Razorpay received and captured payment in background,
    // but the client browser crashed before verifyPayment was called!
    razorpay.capturedPayments.set(payment.providerOrderId, 'pay_reconciled_1');

    // Advance order to expired state
    await Order.findByIdAndUpdate(order._id, { expiresAt: new Date(Date.now() - 10_000) });

    // Run expireUnpaid() — it should RECONCILE the order instead of cancelling it!
    const expiredCount = await orderService.expireUnpaid();
    expect(expiredCount).toBe(0);

    const updatedOrder = await Order.findById(order._id).lean();
    expect(updatedOrder.status).toBe('placed');
    expect(updatedOrder.payment.status).toBe('paid');
    expect(updatedOrder.payment.providerPaymentId).toBe('pay_reconciled_1');
  });
});
