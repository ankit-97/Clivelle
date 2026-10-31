import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { checkDatabase, isDatabaseConfigured } from './database.js';

export const app = express();
app.disable('x-powered-by');
if (config.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok', service: 'clivelle-api' });
});

app.get('/health/ready', async (_req, res) => {
  if (!isDatabaseConfigured()) {
    return res.status(503).json({ status: 'not_ready', database: 'not_configured' });
  }
  try {
    await checkDatabase();
    return res.json({ status: 'ready', database: 'connected' });
  } catch {
    return res.status(503).json({ status: 'not_ready', database: 'unavailable' });
  }
});

app.get(config.API_BASE_PATH, (_req, res) => {
  res.json({
    name: 'Clivelle API',
    version: 'v1',
    status: 'foundation',
    endpoints: {
      live: '/health/live',
      ready: '/health/ready'
    }
  });
});

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
});

app.use((error, _req, res, _next) => {
  if (error.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed.' } });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  }
  console.error('Unhandled API error:', error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
});
