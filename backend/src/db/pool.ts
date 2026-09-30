import pg from 'pg';
import { config } from '../config/index.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  process.exit(1);
});
