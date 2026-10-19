import express from 'express';
import cors from 'cors';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import workshopRoutes from './routes/workshopRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { NotFoundError } from './utils/errors.js';

// Load OpenAPI spec for Swagger UI
const swaggerDocument = JSON.parse(
  fs.readFileSync(new URL('./docs/swagger.json', import.meta.url), 'utf-8')
);

export function createApp() {
  const app = express();

  // Basic security and parsing middleware
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // Swagger Documentation
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  // Application Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/workshops', workshopRoutes);
  app.use('/api/notifications', notificationRoutes);

  // Handle 404 for unknown endpoints
  app.use((req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}

export default createApp;
