// Prefer the 26-table Microsoft SQL Server schema whenever explicit SQL Server
// connection settings are supplied. Keep PostgreSQL as the current hosted fallback
// until a reachable SQL Server endpoint is configured in Render.
const hasSqlServerConfig = Boolean(process.env.DB_SERVER && process.env.DB_NAME &&
  (process.env.DB_AUTH === 'windows' || (process.env.DB_USER && process.env.DB_PASSWORD)));

if (hasSqlServerConfig) {
  await import('./server.js');
} else if (process.env.DATABASE_URL || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production') {
  await import('./postgres-server.js');
} else {
  await import('./server.js');
}
