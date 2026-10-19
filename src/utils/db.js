import mongoose from 'mongoose';
import logger from './logger.js';

export async function connectDB(uri) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true,
    });
    logger.info('Connected to MongoDB', { host: conn.connection.host, name: conn.connection.name });
    return conn.connection;
  } catch (error) {
    logger.error('Failed to connect to MongoDB', error);
    throw error;
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
}

/**
 * Executes an operation inside a MongoDB multi-document transaction.
 * Mongoose session.withTransaction automatically retries transient errors
 * and handles commit/abort lifecycle.
 */
export async function runInTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
