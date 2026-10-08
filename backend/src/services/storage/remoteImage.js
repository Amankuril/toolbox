import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { env } from '#config/env.js';

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 30_000;

/** Ranges that must never be fetched on a user's behalf (loopback, private, link-local/metadata, CGNAT, multicast…). */
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

export class RemoteImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RemoteImageError';
  }
}

const isBlocked = (address, family) => blocked.check(address, family === 6 || family === 'IPv6' ? 'ipv6' : 'ipv4');

/**
 * DNS lookup used by the socket itself, so the address checked is the address connected to
 * (no gap for DNS rebinding between a pre-check and the request).
 */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const allowed = addresses.filter((a) => !isBlocked(a.address, a.family));
    if (!allowed.length) return callback(new RemoteImageError('Image host is not allowed'));
    if (options.all) return callback(null, allowed);
    return callback(null, allowed[0].address, allowed[0].family);
  });
}

function get(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'user-agent': `${env.APP_NAME}-image-import/1.0`, accept: 'image/*' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, url) });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new RemoteImageError(`Image URL returned HTTP ${res.statusCode}`));
          return;
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          res.destroy();
          reject(new RemoteImageError('Image is too large'));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new RemoteImageError('Image is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new RemoteImageError('Image download timed out')));
    // `timeout` above only fires on an idle socket; a server trickling bytes needs an overall deadline too.
    const deadline = setTimeout(() => req.destroy(new RemoteImageError('Image download took too long')), TOTAL_TIMEOUT_MS);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', (err) =>
      reject(err instanceof RemoteImageError ? err : new RemoteImageError(`Could not download image (${err.code ?? err.message})`)),
    );
  });
}

/**
 * Downloads an image from a public http(s) URL with size, time and redirect limits.
 * Content is not trusted here; the caller re-encodes it (which also rejects non-images).
 */
export async function downloadRemoteImage(rawUrl, { maxBytes = env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteImageError('Not a valid URL');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new RemoteImageError('Only http and https image URLs are supported');
    if (url.username || url.password) throw new RemoteImageError('Image URLs must not contain credentials');
    // IP literals skip DNS (and so safeLookup), so they're checked here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlocked(host, net.isIP(host))) throw new RemoteImageError('Image host is not allowed');
    const result = await get(url, maxBytes);
    if (result.buffer)
      return { buffer: result.buffer, originalname: decodeURIComponent(url.pathname.split('/').pop() || 'image').slice(0, 200) };
    url = result.redirect;
  }
  throw new RemoteImageError('Too many redirects');
}
