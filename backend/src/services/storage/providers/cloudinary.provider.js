import { v2 as cloudinary } from 'cloudinary';
import { ApiError } from '#core/errors/ApiError.js';

export function createCloudinaryProvider({ cloudName, apiKey, apiSecret, rootFolder }) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

  return {
    name: 'cloudinary',

    put(buffer, { key }) {
      // key = "<folder>/<yyyy>/<mm>/<uuid>.webp" → Cloudinary public_id without extension.
      const publicId = `${rootFolder}/${key.replace(/\.webp$/, '')}`;
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { public_id: publicId, resource_type: 'image', format: 'webp', overwrite: false, unique_filename: false },
          (err, result) => {
            if (err || !result) {
              reject(ApiError.serviceUnavailable('Image upload to Cloudinary failed', { cause: err, code: 'STORAGE_UPLOAD_FAILED' }));
              return;
            }
            resolve({ key: result.public_id, url: result.secure_url });
          },
        );
        stream.end(buffer);
      });
    },

    async remove({ key }) {
      await cloudinary.uploader.destroy(key, { resource_type: 'image', invalidate: true });
    },
  };
}
