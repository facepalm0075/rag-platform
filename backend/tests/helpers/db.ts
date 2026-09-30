import { pool } from '../../src/db/pool.js';

export async function truncateAll(): Promise<void> {
  await pool.query(
    'TRUNCATE users, sessions, conversations, documents, chunks, messages, example_embeddings, system_logs RESTART IDENTITY CASCADE'
  );
}

export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 8000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}

export function makeVector(value: number, dim = 768): number[] {
  return Array.from({ length: dim }, () => value);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
