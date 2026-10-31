// Render production must always use the PostgreSQL server. Do not silently
// fall back to the SQL Server implementation when DATABASE_URL is missing:
// that path can require the native msnodesqlv8/ODBC driver, which is not part
// of the PostgreSQL deployment. postgres-server.js reports the missing URL.
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
  await import('./postgres-server.js');
} else {
  await import('./server.js');
}
