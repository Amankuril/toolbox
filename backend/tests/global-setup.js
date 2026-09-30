import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function setup({ provide }) {
  const mongod = await MongoMemoryServer.create();
  provide('mongoUri', mongod.getUri());
  return async () => {
    await mongod.stop();
  };
}
