import { fileTypeFromBuffer } from 'file-type';
import { ApiError } from '#core/errors/ApiError.js';

/** Formats every current browser plays natively, by detected type → stored extension. */
const ACCEPTED = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/**
 * Videos are stored as uploaded (no server-side transcoding), so the only check is that the
 * bytes really are one of the accepted containers, read from magic bytes rather than the name.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ buffer: Buffer, size: number, mimeType: string, ext: string }>}
 */
export async function processVideo(buffer) {
  const detected = await fileTypeFromBuffer(buffer);
  const ext = detected && ACCEPTED[detected.mime];
  if (!ext) throw ApiError.badRequest('Unsupported video. Upload an MP4, WebM or MOV file.', { code: 'UNSUPPORTED_FILE' });
  return { buffer, size: buffer.length, mimeType: detected.mime, ext };
}
