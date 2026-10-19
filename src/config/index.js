import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MOCK_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/workshop_db?replicaSet=rs0'),
  MOCK_NOTIFICATION_URL: z.string().url().default('http://localhost:4000/notifications'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  WORKER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(15000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WORKER_INITIAL_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  WORKER_BACKOFF_FACTOR: z.coerce.number().positive().default(2),
  WORKER_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(60000),
  WORKER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const config = Object.freeze(parsed.data);
export default config;
