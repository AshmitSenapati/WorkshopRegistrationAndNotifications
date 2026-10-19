import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, afterAll, beforeEach } from 'vitest';

let replSet;

export async function setupTestDB() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  return uri;
}

export async function teardownTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
}

export async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}
