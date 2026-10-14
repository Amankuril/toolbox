import { v2 as cloudinary } from 'cloudinary';
import { ApiError } from '#core/errors/ApiError.js';

export function createCloudinaryProvider({ cloudName, apiKey, apiSecret, rootFolder }) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

  return {
    name: 'cloudinary',

    put(buffer, { key, resourceType = 'image' }) {
      // key = "<folder>/<yyyy>/<mm>/<uuid>.<ext>" → Cloudinary public_id without extension.
      const publicId = `${rootFolder}/${key.replace(/\.\w+$/, '')}`;
      const options =
        resourceType === 'video'
          ? { public_id: publicId, resource_type: 'video', overwrite: false, unique_filename: false }
          : { public_id: publicId, resource_type: 'image', format: 'webp', overwrite: false, unique_filename: false };
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
          if (err || !result) {
            reject(ApiError.serviceUnavailable('Upload to Cloudinary failed', { cause: err, code: 'STORAGE_UPLOAD_FAILED' }));
            return;
          }
          resolve({ key: result.public_id, url: result.secure_url });
        });
        stream.end(buffer);
      });
    },

    async remove({ key, mimeType }) {
      await cloudinary.uploader.destroy(key, { resource_type: mimeType?.startsWith('video/') ? 'video' : 'image', invalidate: true });
    },
  };
}
