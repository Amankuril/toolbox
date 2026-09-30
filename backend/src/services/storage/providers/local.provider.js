import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Stores files on local disk. In production the directory is /var/www/toolbox/uploads and nginx
 * serves `publicPath` straight from disk; in development Express serves it.
 */
export function createLocalProvider({ rootDir, publicPath }) {
  const resolveSafe = (key) => {
    const target = path.resolve(rootDir, key);
    if (!target.startsWith(rootDir + path.sep)) throw new Error('Refusing to access a path outside the upload directory');
    return target;
  };

  return {
    name: 'local',

    async put(buffer, { key }) {
      const target = resolveSafe(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Write then rename so nginx never serves a half-written file.
      const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, buffer, { mode: 0o644 });
      await fs.rename(tmp, target);
      return { key, url: `${publicPath}/${key}` };
    },

    async remove({ key }) {
      await fs.rm(resolveSafe(key), { force: true });
    },
  };
}
