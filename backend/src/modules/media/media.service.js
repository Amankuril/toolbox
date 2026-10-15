import { ApiError } from '#core/errors/ApiError.js';
import { paginate } from '#core/utils/pagination.js';
import { downloadRemoteImage, downloadRemoteVideo, RemoteImageError } from '#services/storage/remoteImage.js';
import { storageService } from '#services/storage/storage.service.js';
import { parseVideoEmbed } from './embeds.js';
import { Media } from './media.model.js';

/** Upload folders each audience may write to. */
export const FOLDER_ACCESS = {
  admin: ['products', 'categories', 'vendors', 'documents', 'banners', 'branding', 'favicons', 'users', 'reviews'],
  vendor: ['products', 'categories', 'vendors', 'documents'],
  user: ['users', 'reviews'],
};

/** Folders that take videos (product pages are the only place they're shown). */
export const VIDEO_FOLDERS = ['products'];

const isVideo = (doc) => doc.mimeType?.startsWith('video/');

function assertFolder(folder, actor, kind = 'image') {
  if (!FOLDER_ACCESS[actor.kind]?.includes(folder)) throw ApiError.forbidden(`You cannot upload to "${folder}"`);
  if (kind === 'video' && !VIDEO_FOLDERS.includes(folder))
    throw ApiError.badRequest('Videos can only be added to products', { code: 'VIDEO_NOT_ALLOWED' });
}

/** A link that couldn't be fetched is the user's to fix, not a server fault. */
async function fetchRemote(download, url) {
  try {
    return await download(url);
  } catch (err) {
    if (err instanceof RemoteImageError) throw ApiError.unprocessable(err.message, { code: 'REMOTE_FETCH_FAILED' });
    throw err;
  }
}

export function serializeMedia(m) {
  return {
    _id: m._id,
    url: m.url,
    mimeType: m.mimeType,
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
    assertFolder(folder, actor);

    // Sequential keeps peak memory bounded (sharp is CPU heavy and already multi-threaded).
    const results = [];
    for (const file of files) {
      results.push(serializeMedia(await storageService.uploadImage(file, { folder, uploadedBy: actor })));
    }
    return results;
  },

  async uploadVideo(file, { folder, actor }) {
    if (!file) throw ApiError.badRequest('Attach a video in the "file" field', { code: 'NO_FILES' });
    assertFolder(folder, actor, 'video');
    const media = await storageService.uploadVideo(file, { folder, uploadedBy: actor });
    return { source: 'upload', media: media._id, url: media.url };
  },

  /**
   * Adds media from a link. Images and video files are downloaded and stored like uploads (so pages
   * never depend on someone else's server); YouTube and Vimeo links are kept as embeds.
   * Returns the value to put in the form: `{ media, url }` for images, a product video for videos.
   */
  async fromUrl({ url, kind, folder }, actor) {
    assertFolder(folder, actor, kind);
    if (kind === 'video') {
      const embed = parseVideoEmbed(url);
      if (embed) return embed;
      const file = await fetchRemote(downloadRemoteVideo, url);
      const media = await storageService.uploadVideo({ ...file, size: file.buffer.length }, { folder, uploadedBy: actor });
      return { source: 'upload', media: media._id, url: media.url };
    }
    const file = await fetchRemote(downloadRemoteImage, url);
    const media = await storageService.uploadImage({ ...file, size: file.buffer.length }, { folder, uploadedBy: actor });
    return { media: media._id, url: media.url };
  },

  /**
   * Turns client-supplied `{ media, alt }` refs into stored `{ media, url, alt }` refs.
   * Non-admin actors may only reference media they uploaded themselves.
   *
   * @param {Array<{ media: string, alt?: string }>} refs
   * @param {{ kind: string, id: any }} actor
   * @param {{ type?: 'image'|'video', allow?: Set<string> }} [opts] what the refs must point at; `allow`:
   *   ids the actor may use although someone else uploaded them (e.g. the photos of a product being cloned)
   */
  async resolve(refs, actor, { type = 'image', allow } = {}) {
    if (!refs?.length) return [];
    const ids = [...new Set(refs.map((r) => String(r.media)))];
    const docs = await Media.find({ _id: { $in: ids } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    return refs.map((ref) => {
      const doc = byId.get(String(ref.media));
      if (!doc) throw ApiError.unprocessable('One of the images no longer exists. Please upload it again.', { code: 'MEDIA_NOT_FOUND' });
      const owns =
        (doc.uploadedBy.kind === actor.kind && String(doc.uploadedBy.id) === String(actor.id)) || Boolean(allow?.has(String(doc._id)));
      if (actor.kind !== 'admin' && !owns) throw ApiError.forbidden('You can only use images you uploaded', { code: 'MEDIA_FORBIDDEN' });
      if (isVideo(doc) !== (type === 'video')) {
        throw ApiError.unprocessable(type === 'video' ? 'That file is not a video' : 'That file is not an image', {
          code: 'MEDIA_WRONG_TYPE',
        });
      }
      return { media: doc._id, url: doc.url, ...(ref.alt ? { alt: ref.alt } : {}) };
    });
  },

  async resolveOne(ref, actor) {
    if (!ref) return ref;
    const [resolved] = await this.resolve([ref], actor);
    return resolved;
  },

  /**
   * Product videos from client input: uploaded files resolve like images (ownership + type checked),
   * links must be YouTube or Vimeo and are reduced to a clean embed.
   *
   * @param {Array<{ media?: string, url?: string, title?: string }>} inputs
   */
  async resolveVideos(inputs, actor, { allow } = {}) {
    if (!inputs?.length) return [];
    const uploads = await this.resolve(
      inputs.filter((v) => v.media),
      actor,
      { type: 'video', allow },
    );
    let next = 0;
    return inputs.map((v, i) => {
      const title = v.title ? { title: v.title } : {};
      if (v.media) {
        const { media, url } = uploads[next++];
        return { source: 'upload', media, url, ...title };
      }
      const embed = parseVideoEmbed(v.url);
      if (!embed) {
        throw ApiError.unprocessable('Use a YouTube or Vimeo link, or upload the video file', {
          code: 'INVALID_VIDEO_LINK',
          details: [{ path: `videos.${i}.url`, message: 'Not a YouTube or Vimeo link' }],
        });
      }
      return { ...embed, ...title };
    });
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
