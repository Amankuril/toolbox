import zlib from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redis } from '#config/redis.js';
import { clientKey } from '#core/middlewares/rateLimit.js';
import { assertSafeZip, readSheet, toCsv } from '#modules/products/imports/import.sheets.js';
import { Product } from '#modules/products/product.model.js';
import { otpService } from '#services/otp/otp.service.js';
import { API, approvedVendor, bearer, createAdmin, lastOtp, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9411000001' });
  await setModeration({ autoApproveProducts: true });
});
afterAll(stopTestApp);

describe('OTP brute force', () => {
  it('counts parallel guesses before comparing, so the attempt limit holds under concurrency', async () => {
    const target = '+919411000077';
    await otpService.send('user', target);
    const code = lastOtp(target);
    const wrong = code === '000000' ? '111111' : '000000';

    // Eight wrong guesses and the right one, all in flight together: the right one arrives after the limit.
    const results = await Promise.allSettled([...Array(8).fill(wrong), code].map((otp) => otpService.verify('user', target, otp)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    await expect(otpService.verify('user', target, code)).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('a code works once, even when submitted twice at the same time', async () => {
    const target = '+919411000078';
    await otpService.send('user', target);
    const code = lastOtp(target);
    const results = await Promise.allSettled([otpService.verify('user', target, code), otpService.verify('user', target, code)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('parallel sends to one number deliver one code (cooldown is claimed atomically)', async () => {
    const target = '+919411000079';
    const results = await Promise.allSettled([1, 2, 3].map(() => otpService.send('user', target)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'OTP_COOLDOWN')).toBe(true);
    expect(Number(await redis.get(`otp:quota:${target}`))).toBe(1);
  });
});

describe('rate-limit client keys', () => {
  it('groups IPv6 clients by /64 and leaves IPv4 alone', () => {
    expect(clientKey({ ip: '203.0.113.9' })).toBe('203.0.113.9');
    expect(clientKey({ ip: '::ffff:203.0.113.9' })).toBe('203.0.113.9');
    expect(clientKey({ ip: '2001:db8:aa:bb:1:2:3:4' })).toBe('2001:db8:aa:bb::/64');
    expect(clientKey({ ip: '2001:db8:aa:bb::99' })).toBe(clientKey({ ip: '2001:db8:aa:bb:ffff:0:0:1' }));
    expect(clientKey({ ip: '2001:db8::1' })).toBe('2001:db8:0:0::/64');
  });
});

describe('spreadsheets', () => {
  it('neutralises formulas in CSV exports and round-trips them on re-import', async () => {
    const csv = toCsv([
      ['name', 'price'],
      ['=HYPERLINK("http://x","y")', 100],
      ['-5% promo', -5],
      ['Plain', 1],
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(`'-5% promo`);
    expect(csv).toContain(',-5'); // numbers are left alone
    const rows = await readSheet(Buffer.from(csv), 'x.csv', { maxRows: 10 });
    expect(rows[1][0]).toBe('=HYPERLINK("http://x","y")');
    expect(rows[2][0]).toBe('-5% promo');
  });

  it('rejects a zip whose entry inflates far beyond what it declares', async () => {
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    const data = zlib.deflateRawSync(Buffer.alloc(100 * 1024 * 1024)); // ~100 KB on disk, 100 MB inflated
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(1024, 22); // lies: "1 KB"
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(1024, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cdOffset, 16);
    const bomb = Buffer.concat([local, name, data, central, name, eocd]);
    await expect(assertSafeZip(bomb)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE', message: expect.stringContaining('too large') });
  });
});

describe('product edits vs. live stock', () => {
  it('keeps sales made while the edit form was open, and still applies deliberate stock changes', async () => {
    const V = bearer(vendor.accessToken);
    const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Hand Tools' }).expect(201))
      .body.data;
    const body = {
      type: 'tool',
      name: 'Stanley Claw Hammer 16oz',
      category: cat._id,
      pricing: { mrp: 90_000, price: 75_000, gstRate: 18 },
      inventory: { stock: 10, moq: 1 },
      hsnCode: '8205',
      publish: true,
    };
    const created = (await request(app).post(`${API}/vendor/products`).set(V).send(body).expect(201)).body.data;

    // The seller opens the form (sees 10); meanwhile three units sell.
    await Product.updateOne({ _id: created._id }, { $inc: { 'inventory.stock': -3 } });

    // Saving a description change sends back the 10 the form loaded.
    await request(app)
      .patch(`${API}/vendor/products/${created._id}`)
      .set(V)
      .send({ ...body, shortDescription: 'Forged steel', stockBase: { stock: 10, variants: [] } })
      .expect(200);
    expect((await Product.findById(created._id).lean()).inventory.stock).toBe(7);

    // Typing a new quantity is a deliberate change and wins.
    await request(app)
      .patch(`${API}/vendor/products/${created._id}`)
      .set(V)
      .send({ ...body, inventory: { stock: 25, moq: 1 }, stockBase: { stock: 7, variants: [] } })
      .expect(200);
    expect((await Product.findById(created._id).lean()).inventory.stock).toBe(25);
  });
});
