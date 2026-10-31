import sql from 'mssql/msnodesqlv8.js';
import { config } from './config.js';

let poolPromise;

export function isDatabaseConfigured() {
  return config.databaseConfigured;
}

export async function getPool() {
  if (!isDatabaseConfigured()) {
    const error = new Error('Database is not configured. Set DB_SERVER and DB_NAME; SQL authentication also requires DB_USER and DB_PASSWORD.');
    error.apiCode = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!poolPromise) {
    const connection = config.DB_AUTH === 'windows'
      ? {
          connectionString: [
            `Driver={${config.DB_ODBC_DRIVER}}`,
            `Server=${config.DB_SERVER}${config.DB_PORT === 1433 ? '' : `,${config.DB_PORT}`}`,
            `Database=${config.DB_NAME}`,
            'Trusted_Connection=Yes',
            `Encrypt=${config.DB_ENCRYPT === 'true' ? 'Yes' : 'No'}`,
            `TrustServerCertificate=${config.DB_TRUST_SERVER_CERTIFICATE === 'true' ? 'Yes' : 'No'}`
          ].join(';') + ';'
        }
      : {
          server: config.DB_SERVER,
          port: config.DB_PORT,
          database: config.DB_NAME,
          user: config.DB_USER,
          password: config.DB_PASSWORD,
          options: {
            encrypt: config.DB_ENCRYPT === 'true',
            trustServerCertificate: config.DB_TRUST_SERVER_CERTIFICATE === 'true'
          }
        };

    const pool = new sql.ConnectionPool({
      ...connection,
      pool: { max: config.DB_POOL_MAX, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: config.DB_CONNECTION_TIMEOUT_MS,
      requestTimeout: config.DB_REQUEST_TIMEOUT_MS
    });
    poolPromise = pool.connect().catch((error) => {
      poolPromise = undefined;
      error.apiCode = 'DATABASE_UNAVAILABLE';
      throw error;
    });
  }
  return poolPromise;
}

export async function checkDatabase() {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

export async function closeDatabase() {
  if (poolPromise) {
    const current = poolPromise;
    poolPromise = undefined;
    try {
      const pool = await current;
      await pool.close();
    } catch {
      // A failed connection has no open pool to close.
    }
  }
}
