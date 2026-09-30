import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool } from '../../src/db/pool.js';
import {
  insertSystemLog,
  querySystemLogs,
  countSystemLogsByLevel,
  countSystemLogsSince,
} from '../../src/repositories/systemLog.js';
import { createUser } from '../../src/repositories/user.js';
import { truncateAll } from '../helpers/db.js';

describe('system log repository', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(() => pool.end());

  it('inserts a log entry and reads it back', async () => {
    await insertSystemLog('info', 'auth', 'User logged in', { foo: 'bar' });

    const { rows, total } = await querySystemLogs({});
    expect(total).toBe(1);
    expect(rows[0].level).toBe('info');
    expect(rows[0].category).toBe('auth');
    expect(rows[0].message).toBe('User logged in');
    expect(rows[0].meta).toEqual({ foo: 'bar' });
    expect(rows[0].user_id).toBeNull();
  });

  it('stores user context on the entry', async () => {
    const user = await createUser('loguser', 'hash');
    await insertSystemLog('warn', 'auth', 'Login failed: wrong password', {}, {
      userId: user.id,
      username: user.username,
    });

    const { rows } = await querySystemLogs({});
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].username).toBe('loguser');
  });

  it('filters by level, category, search and time range', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO system_logs (timestamp, level, category, message, username)
       VALUES
         ($1, 'error', 'worker', 'worker crashed', 'alice'),
         (NOW(), 'info', 'auth', 'User logged in', 'alice'),
         (NOW(), 'warn', 'documents', 'ingest warning', 'bob')`,
      [old]
    );

    const levelOnly = await querySystemLogs({ level: 'error' });
    expect(levelOnly.total).toBe(1);
    expect(levelOnly.rows[0].message).toBe('worker crashed');

    const categoryOnly = await querySystemLogs({ category: 'auth' });
    expect(categoryOnly.total).toBe(1);

    const searchOnly = await querySystemLogs({ search: 'bob' });
    expect(searchOnly.total).toBe(1);
    expect(searchOnly.rows[0].message).toBe('ingest warning');

    const sinceFilter = await querySystemLogs({ from: new Date(Date.now() - 10 * 60 * 1000) });
    expect(sinceFilter.total).toBe(2);

    const range = await querySystemLogs({
      from: new Date(Date.now() - 60 * 1000),
      to: new Date(Date.now() + 60 * 1000),
      category: 'documents',
    });
    expect(range.total).toBe(1);
  });

  it('paginates newest first', async () => {
    for (let i = 1; i <= 5; i++) {
      await insertSystemLog('info', 'app', `entry ${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await querySystemLogs({ limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.rows.map((r) => r.message)).toEqual(['entry 5', 'entry 4']);

    const page3 = await querySystemLogs({ limit: 2, offset: 4 });
    expect(page3.rows.map((r) => r.message)).toEqual(['entry 1']);
  });

  it('aggregates counts by level', async () => {
    await insertSystemLog('error', 'worker', 'boom');
    await insertSystemLog('warn', 'auth', 'bad login');
    await insertSystemLog('info', 'auth', 'login ok');

    const counts = await countSystemLogsByLevel();
    const byLevel = Object.fromEntries(counts.map((c) => [c.level, c.count]));
    expect(byLevel).toEqual({ error: 1, warn: 1, info: 1 });
  });

  it('counts entries since a cutoff, optionally filtered by level', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO system_logs (timestamp, level, category, message)
       VALUES ($1, 'error', 'worker', 'old crash')`,
      [old]
    );
    await insertSystemLog('error', 'worker', 'new crash');
    await insertSystemLog('info', 'auth', 'login ok');

    expect(await countSystemLogsSince(new Date(Date.now() - 10 * 60 * 1000))).toBe(2);
    expect(await countSystemLogsSince(new Date(Date.now() - 10 * 60 * 1000), 'error')).toBe(1);
  });
});
