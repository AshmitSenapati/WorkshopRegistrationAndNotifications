import createApp from './app.js';
import config from './config/index.js';
import { connectDB, disconnectDB } from './utils/db.js';
import logger from './utils/logger.js';

let server;

async function start() {
  try {
    await connectDB(config.MONGODB_URI);

    const app = createApp();
    const port = config.PORT || 3000;

    server = app.listen(port, () => {
      logger.info(`Workshop API Server running on port ${port}`, {
        port,
        env: config.NODE_ENV,
        docs: `http://localhost:${port}/api/docs`,
      });
      console.log(`[API Server] Server listening on http://localhost:${port}`);
      console.log(`[API Server] Interactive Docs available at http://localhost:${port}/api/docs`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[API Server Error] Port ${port} is already in use by another process.`);
        console.error(`[API Server Error] Please stop the existing process or set PORT to another port in your .env file.`);
        process.exit(1);
      } else {
        console.error(`[API Server Error] Server failed to start:`, err);
        process.exit(1);
      }
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      console.log(`\n[API Server] Received ${signal}. Closing HTTP server...`);

      if (server) {
        server.close(async () => {
          logger.info('HTTP server closed');
          await disconnectDB();
          process.exit(0);
        });
      } else {
        await disconnectDB();
        process.exit(0);
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start server', err);
    console.error('[API Server] Fatal startup error:', err);
    process.exit(1);
  }
}

start();
