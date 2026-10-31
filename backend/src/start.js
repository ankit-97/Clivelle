// Render deployments use PostgreSQL. Never fall back to the SQL Server
// implementation on Render: that path may require the native msnodesqlv8
// driver, which is intentionally omitted from the Render production install.
const isRender = Boolean(process.env.RENDER_SERVICE_ID);
const isProduction = process.env.NODE_ENV === 'production';

if (isRender || isProduction || process.env.DATABASE_URL) {
  await import('./postgres-server.js');
} else {
  await import('./server.js');
}
