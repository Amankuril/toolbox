import sharp from 'sharp';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { createClaudeVisionProvider } from './providers/claude.provider.js';

let provider = env.imageSearchConfigured ? createClaudeVisionProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.IMAGE_SEARCH_MODEL }) : null;

/**
 * Turns a product photo into what a buyer would have typed. Every image search goes through here,
 * so the provider can be swapped (or stubbed in tests) in one place.
 */
export const visionService = {
  get enabled() {
    return Boolean(provider);
  },

  /**
   * @param {Buffer} buffer the uploaded photo (any format sharp reads)
   * @param {Array<{ id: string, path: string }>} categories
   */
  async identify(buffer, categories) {
    if (!provider) return null;
    // Phone photos are 3–12 MB; 1024 px JPEG is plenty to read a rating plate and costs far fewer tokens.
    const jpeg = await sharp(buffer, { failOn: 'error', animated: false })
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const started = Date.now();
    const result = await provider.identify({ data: jpeg.toString('base64'), mediaType: 'image/jpeg' }, categories);
    logger.info({ provider: provider.name, ms: Date.now() - started, recognised: result?.recognised }, 'image search identified');
    return result;
  },

  /** Tests swap in a fake. */
  _setProvider(p) {
    provider = p;
  },
};
