import { ApiError } from '#core/errors/ApiError.js';
import { paginate } from '#core/utils/pagination.js';
import { storageService } from '#services/storage/storage.service.js';
import { Media } from './media.model.js';

/** Upload folders each audience may write to. */
export const FOLDER_ACCESS = {
  admin: ['products', 'categories', 'vendors', 'documents', 'banners', 'branding', 'favicons', 'users'],
  vendor: ['products', 'categories', 'vendors', 'documents'],
  user: ['users'],
};

export function serializeMedia(m) {
  return {
    _id: m._id,
    url: m.url,
    provider: m.provider,
    folder: m.folder,
    width: m.width,
    height: m.height,
    size: m.size,
    createdAt: m.createdAt,
  };
}

export const mediaService = {
  async upload(files, { folder, actor }) {
    if (!files?.length) throw ApiError.badRequest('Attach at least one image in the "files" field', { code: 'NO_FILES' });
    if (!FOLDER_ACCESS[actor.kind]?.includes(folder)) throw ApiError.forbidden(`You cannot upload to "${folder}"`);

    // Sequential keeps peak memory bounded (sharp is CPU heavy and already multi-threaded).
    const results = [];
    for (const file of files) {
      results.push(serializeMedia(await storageService.uploadImage(file, { folder, uploadedBy: actor })));
    }
    return results;
  },

  /**
   * Turns client-supplied `{ media, alt }` refs into stored `{ media, url, alt }` refs.
   * Non-admin actors may only reference media they uploaded themselves.
   *
   * @param {Array<{ media: string, alt?: string }>} refs
   * @param {{ kind: string, id: any }} actor
   */
  async resolve(refs, actor) {
    if (!refs?.length) return [];
    const ids = [...new Set(refs.map((r) => String(r.media)))];
    const docs = await Media.find({ _id: { $in: ids } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    return refs.map((ref) => {
      const doc = byId.get(String(ref.media));
      if (!doc) throw ApiError.unprocessable('One of the images no longer exists. Please upload it again.', { code: 'MEDIA_NOT_FOUND' });
      const owns = doc.uploadedBy.kind === actor.kind && String(doc.uploadedBy.id) === String(actor.id);
      if (actor.kind !== 'admin' && !owns) throw ApiError.forbidden('You can only use images you uploaded', { code: 'MEDIA_FORBIDDEN' });
      return { media: doc._id, url: doc.url, ...(ref.alt ? { alt: ref.alt } : {}) };
    });
  },

  async resolveOne(ref, actor) {
    if (!ref) return ref;
    const [resolved] = await this.resolve([ref], actor);
    return resolved;
  },

  list({ page, limit, folder, provider }) {
    const filter = {};
    if (folder) filter.folder = folder;
    if (provider) filter.provider = provider;
    return paginate(Media, filter, { page, limit });
  },

  async remove(id) {
    const media = await Media.findById(id);
    if (!media) throw ApiError.notFound('File not found');
    await storageService.remove(media);
  },
};
