import config from '../config/index.js';
import { connectDB, disconnectDB } from '../utils/db.js';
import NotificationWorker from './notificationWorker.js';
import logger from '../utils/logger.js';

async function run() {
  try {
    await connectDB(config.MONGODB_URI);
    logger.info('Worker connected to MongoDB');

    const worker = new NotificationWorker();
    worker.start();
    console.log(`[Worker] Notification Worker running with poll interval ${worker.pollIntervalMs}ms`);

    const shutdown = async (signal) => {
      console.log(`\n[Worker] Received ${signal}. Shutting down gracefully...`);
      await worker.stop();
      await disconnectDB();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Worker failed to start', err);
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
  }
}

run();
