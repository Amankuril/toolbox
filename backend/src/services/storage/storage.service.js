import crypto from 'node:crypto';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Media } from '#modules/media/media.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { processImage } from './image.processor.js';
import { createCloudinaryProvider } from './providers/cloudinary.provider.js';
import { createLocalProvider } from './providers/local.provider.js';

const providers = {
  local: createLocalProvider({ rootDir: env.LOCAL_UPLOAD_DIR, publicPath: env.LOCAL_UPLOAD_PUBLIC_PATH }),
  cloudinary: env.cloudinaryConfigured
    ? createCloudinaryProvider({
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
        rootFolder: env.CLOUDINARY_FOLDER,
      })
    : null,
};

function buildKey(folder) {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${folder}/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}.webp`;
}

/**
 * Centralised upload service. The active provider is chosen per upload from the admin
 * `storage.cloudinaryEnabled` toggle: ON → Cloudinary, OFF → local disk.
 */
export const storageService = {
  async activeProviderName() {
    const { cloudinaryEnabled } = await settingsService.get('storage');
    if (cloudinaryEnabled && providers.cloudinary) return 'cloudinary';
    if (cloudinaryEnabled && !providers.cloudinary) {
      logger.warn('Cloudinary enabled in settings but not configured; falling back to local storage');
    }
    return 'local';
  },

  /**
   * Compresses → WebP → stores → records a Media document.
   * @param {{ buffer: Buffer, originalname?: string, size?: number }} file  multer memory file
   * @param {{ folder: string, uploadedBy: { kind: string, id?: any } }} opts
   */
  async uploadImage(file, { folder, uploadedBy }) {
    const processed = await processImage(file.buffer);
    const providerName = await this.activeProviderName();
    const provider = providers[providerName];

    const stored = await provider.put(processed.buffer, { key: buildKey(folder) });
    try {
      return await Media.create({
        provider: providerName,
        key: stored.key,
        url: stored.url,
        folder,
        mimeType: processed.mimeType,
        size: processed.size,
        width: processed.width,
        height: processed.height,
        originalName: file.originalname?.slice(0, 255),
        originalSize: file.size,
        uploadedBy,
      });
    } catch (err) {
      await provider.remove(stored).catch(() => {});
      throw err;
    }
  },

  /** Deletes the stored bytes via the provider that holds them, then the Media record. */
  async remove(mediaOrId) {
    const media = typeof mediaOrId === 'object' && mediaOrId?.provider ? mediaOrId : await Media.findById(mediaOrId);
    if (!media) return;
    const provider = providers[media.provider];
    if (!provider) {
      throw ApiError.serviceUnavailable(`Storage provider "${media.provider}" is not configured; cannot delete file.`);
    }
    await provider.remove(media);
    await Media.deleteOne({ _id: media._id });
  },
};
