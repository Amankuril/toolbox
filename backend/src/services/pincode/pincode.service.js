import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#core/errors/ApiError.js';

const FOUND_TTL_SECONDS = 30 * 24 * 60 * 60;
const MISSING_TTL_SECONDS = 24 * 60 * 60;

/**
 * Pincode → district/state using India Post's free public API (no key).
 * Response: [{ Status: "Success" | "Error", PostOffice: [{ Name, District, State, Block, ... }] }]
 * Answers are cached in Redis so each pincode is looked up upstream at most once a month.
 */
async function fetchUpstream(pincode) {
  let response;
  try {
    response = await fetch(`${env.PINCODE_LOOKUP_URL}/${pincode}`, { signal: AbortSignal.timeout(env.PINCODE_LOOKUP_TIMEOUT_MS) });
  } catch (err) {
    throw ApiError.serviceUnavailable('Pincode lookup is unavailable right now', { code: 'PINCODE_LOOKUP_UNAVAILABLE', cause: err });
  }
  const body = await response.json().catch(() => null);
  const entry = Array.isArray(body) ? body[0] : null;
  if (!response.ok || !entry) {
    throw ApiError.serviceUnavailable('Pincode lookup is unavailable right now', {
      code: 'PINCODE_LOOKUP_UNAVAILABLE',
      cause: new Error(`India Post ${response.status}`),
    });
  }
  const offices = entry.Status === 'Success' && Array.isArray(entry.PostOffice) ? entry.PostOffice : [];
  if (!offices.length) return null;

  // Post offices in one pincode almost always share a district and state; take the most common.
  const mostCommon = (key) => {
    const counts = new Map();
    for (const o of offices) if (o[key]) counts.set(o[key], (counts.get(o[key]) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return {
    pincode,
    city: mostCommon('District'),
    state: mostCommon('State'),
    areas: [...new Set(offices.map((o) => o.Name).filter(Boolean))].slice(0, 30),
  };
}

export const pincodeService = {
  async lookup(pincode) {
    const key = `pincode:${pincode}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) {
      const hit = JSON.parse(cached);
      if (!hit) throw ApiError.notFound('We could not find this pincode', { code: 'PINCODE_NOT_FOUND' });
      return hit;
    }

    const result = await fetchUpstream(pincode).catch((err) => {
      logger.warn({ err, pincode }, 'Pincode lookup failed');
      throw err;
    });
    await redis.set(key, JSON.stringify(result), 'EX', result ? FOUND_TTL_SECONDS : MISSING_TTL_SECONDS).catch(() => {});
    if (!result) throw ApiError.notFound('We could not find this pincode', { code: 'PINCODE_NOT_FOUND' });
    return result;
  },
};
