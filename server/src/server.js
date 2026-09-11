import 'dotenv/config';
import app from './app.js';
import { pool } from './db.js';

const port = Number(process.env.PORT || 4000);

const server = app.listen(port, () => {
  console.log(`SOLEA API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
