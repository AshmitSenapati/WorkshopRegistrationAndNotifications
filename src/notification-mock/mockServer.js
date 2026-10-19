import express from 'express';
import cors from 'cors';
import config from '../config/index.js';
import mockRoutes from './mockRoutes.js';
import logger from '../utils/logger.js';
import { connectDB } from '../utils/db.js';

export function createMockApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Security guard: protect mock test control endpoints in production
  app.use('/mock', (req, res, next) => {
    if (config.NODE_ENV === 'production') {
      logger.warn('Mock control endpoint accessed in production mode', { path: req.path });
      return res.status(403).json({
        error: 'Forbidden: Mock notification controls are disabled in production mode',
      });
    }
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Service', 'Mock-Notification-Delivery-Service (Dev/Test)');
    next();
  });

  app.use('/', mockRoutes);

  return app;
}

// Standalone execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('mockServer.js')) {
  (async () => {
    try {
      if (config.MONGODB_URI) {
        try {
          await connectDB(config.MONGODB_URI);
        } catch (dbErr) {
          logger.warn('Mock service running without persistent MongoDB connection (using in-memory store)', {
            error: dbErr.message,
          });
        }
      }

      const app = createMockApp();
      const port = config.MOCK_PORT || 4000;
      const server = app.listen(port, () => {
        logger.info(`Mock Notification Service listening on http://localhost:${port}`);
        console.log(`[Mock Service] Mock Notification Service running on http://localhost:${port}`);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[Mock Service Error] Port ${port} is already in use by another process.`);
          console.error(`[Mock Service Error] Please stop the existing process or set MOCK_PORT to another port in your .env file.`);
          process.exit(1);
        } else {
          console.error(`[Mock Service Error] Server failed to start:`, err);
          process.exit(1);
        }
      });

      const shutdown = () => {
        logger.info('Shutting down mock service...');
        server.close(() => {
          process.exit(0);
        });
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    } catch (err) {
      logger.error('Failed to start mock service', err);
      process.exit(1);
    }
  })();
}

export default createMockApp;
