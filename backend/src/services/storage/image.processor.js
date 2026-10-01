import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';

const ACCEPTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
  'image/heic',
  'image/heif',
]);

// Refuse decompression bombs: ~50 megapixels is far above any legitimate product photo.
const MAX_INPUT_PIXELS = 50_000_000;

sharp.cache(false);

/**
 * Normalises every uploaded image: verifies real type from magic bytes, fixes EXIF orientation,
 * strips metadata, bounds dimensions and re-encodes as WebP.
 *
 * @param {Buffer} buffer
 * @param {{ maxDimension?: number, quality?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, size: number, mimeType: 'image/webp', originalMime: string }>}
 */
export async function processImage(buffer, { maxDimension = env.IMAGE_MAX_DIMENSION, quality = env.IMAGE_WEBP_QUALITY } = {}) {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ACCEPTED_MIME.has(detected.mime)) {
    throw ApiError.badRequest('Unsupported file. Upload a JPG, PNG, WebP, AVIF, GIF or HEIC image.', { code: 'UNSUPPORTED_FILE' });
  }

  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, width: info.width, height: info.height, size: info.size, mimeType: 'image/webp', originalMime: detected.mime };
  } catch (err) {
    throw ApiError.badRequest('This image could not be processed. It may be corrupted or too large.', {
      code: 'IMAGE_PROCESSING_FAILED',
      cause: err,
    });
  }
}
