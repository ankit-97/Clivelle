if (process.env.DATABASE_URL) await import('./postgres-server.js');
else await import('./server.js');
