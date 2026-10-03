/**
 * Development MongoDB for machines without a system install. Runs the mongod binary that
 * mongodb-memory-server downloads for the tests, with data kept on disk in backend/.data/mongo.
 *   npm run db:local            start in the background (run again after a reboot)
 *   npm run db:local -- --stop  shut it down cleanly
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoBinary } from 'mongodb-memory-server';

const dataDir = fileURLToPath(new URL('../.data', import.meta.url));
const dbPath = path.join(dataDir, 'mongo');
const logPath = path.join(dataDir, 'mongod.log');
const port = process.env.MONGO_PORT ?? '27017';
const stop = process.argv.includes('--stop');

fs.mkdirSync(dbPath, { recursive: true });
const bin = await MongoBinary.getPath();

const args = stop
  ? ['--shutdown', '--dbpath', dbPath]
  : ['--dbpath', dbPath, '--port', port, '--bind_ip', '127.0.0.1', '--fork', '--logpath', logPath, '--logappend'];
const { status } = spawnSync(bin, args, { stdio: 'inherit' });

if (status !== 0) {
  console.error(
    stop
      ? 'mongod is not running from this data folder.'
      : `mongod did not start. It may already be running, or port ${port} is taken. Log: ${logPath}`,
  );
  process.exit(status ?? 1);
}
console.log(stop ? 'Local MongoDB stopped.' : `Local MongoDB on mongodb://127.0.0.1:${port}, data in ${dbPath}`);
