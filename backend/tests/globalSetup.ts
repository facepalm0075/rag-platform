import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/rag_test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function createDatabaseIfMissing(url: URL, dbName: string): Promise<void> {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await client.end();
  }
}

async function withClient(url: URL, fn: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, '');
  const currentUser = url.username || os.userInfo().username;

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = '/postgres';

  let createdAsSuperuser = false;
  try {
    await createDatabaseIfMissing(maintenanceUrl, dbName);
  } catch (err) {
    const superuserUrl = new URL(maintenanceUrl);
    superuserUrl.username = 'postgres';
    try {
      await createDatabaseIfMissing(superuserUrl, dbName);
      createdAsSuperuser = true;
    } catch (superErr) {
      throw new Error(
        `Could not create test database "${dbName}". ` +
          `Create it manually (e.g. as superuser) or grant CREATEDB, then re-run. Original error: ${(err as Error).message}`
      );
    }
  }

  const superuserDbUrl = new URL(url);
  superuserDbUrl.username = 'postgres';

  await withClient(superuserDbUrl, async (client) => {
    await client.query('DROP EXTENSION IF EXISTS vector CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO PUBLIC');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  });

  if (createdAsSuperuser) {
    await withClient(superuserDbUrl, async (client) => {
      await client.query(`ALTER DATABASE "${dbName}" OWNER TO ${currentUser}`);
    });
  }

  await withClient(url, async (client) => {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query(sql);
    }
    console.log(`Test database ready (${files.length} migrations applied on a fresh schema)`);
  });
}