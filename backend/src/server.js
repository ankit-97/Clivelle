import { app } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './database.js';

const server = app.listen(config.PORT, () => {
  console.log(`Clivelle API listening on port ${config.PORT} (${config.NODE_ENV})`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully.`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
