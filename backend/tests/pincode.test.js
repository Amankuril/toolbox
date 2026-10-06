import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API, startTestApp, stopTestApp } from './helpers.js';

let app;
const realFetch = globalThis.fetch;
let calls = 0;

const office = (Name, District = 'Nashik', State = 'Maharashtra') => ({ Name, District, State, Pincode: '422001' });

beforeAll(async () => {
  app = await startTestApp();
  globalThis.fetch = vi.fn(async (url) => {
    const pin = String(url).split('/').pop();
    calls += 1;
    if (pin === '500500') throw new TypeError('network down');
    const body =
      pin === '422001'
        ? [{ Status: 'Success', PostOffice: [office('Budhwar Peth'), office('Nashik'), office('Nashik')] }]
        : [{ Status: 'Error', Message: 'No records found', PostOffice: null }];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await stopTestApp();
});

describe('pincode lookup', () => {
  it('returns district and state, and caches the answer', async () => {
    const res = await request(app).get(`${API}/public/pincodes/422001`).expect(200);
    expect(res.body.data).toEqual({ pincode: '422001', city: 'Nashik', state: 'Maharashtra', areas: ['Budhwar Peth', 'Nashik'] });
    const before = calls;
    await request(app).get(`${API}/public/pincodes/422001`).expect(200);
    expect(calls).toBe(before);
  });

  it('reports unknown pincodes, invalid input and upstream outages distinctly', async () => {
    expect((await request(app).get(`${API}/public/pincodes/999999`).expect(404)).body.error.code).toBe('PINCODE_NOT_FOUND');
    await request(app).get(`${API}/public/pincodes/012345`).expect(422);
    expect((await request(app).get(`${API}/public/pincodes/500500`).expect(503)).body.error.code).toBe('PINCODE_LOOKUP_UNAVAILABLE');
  });
});
