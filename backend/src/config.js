import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_PATH: z.string().regex(/^\/[a-zA-Z0-9/_-]+$/).default('/api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173,http://127.0.0.1:5500'),
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
  DB_SERVER: z.string().optional(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_ENCRYPT: z.enum(['true', 'false']).default('true'),
  DB_TRUST_SERVER_CERTIFICATE: z.enum(['true', 'false']).default('false'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  DB_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = Object.freeze({
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  databaseConfigured: Boolean(parsed.data.DB_SERVER && parsed.data.DB_NAME && parsed.data.DB_USER && parsed.data.DB_PASSWORD)
});
