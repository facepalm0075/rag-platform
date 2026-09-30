import { pool } from '../db/pool.js';
import { SystemLog, SystemLogFilters } from '../types/index.js';

export async function insertSystemLog(
  level: string,
  category: string,
  message: string,
  meta: Record<string, unknown> = {},
  user?: { userId?: string; username?: string } | null
): Promise<void> {
  await pool.query(
    `INSERT INTO system_logs (level, category, message, meta, user_id, username)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [level, category, message, JSON.stringify(meta), user?.userId ?? null, user?.username ?? null]
  );
}

export async function querySystemLogs(
  filters: SystemLogFilters
): Promise<{ rows: SystemLog[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.level) {
    conditions.push(`level = $${paramIndex++}`);
    params.push(filters.level);
  }
  if (filters.category) {
    conditions.push(`category = $${paramIndex++}`);
    params.push(filters.category);
  }
  if (filters.search) {
    conditions.push(`(message ILIKE $${paramIndex} OR username ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }
  if (filters.from) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(filters.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const result = await pool.query<SystemLog & { total: number }>(
    `SELECT l.*, COUNT(*) OVER()::int AS total
     FROM system_logs l
     ${where}
     ORDER BY l.timestamp DESC, l.id DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  const total = result.rows.length > 0 ? result.rows[0].total : 0;
  return { rows: result.rows, total };
}

export async function countSystemLogsByLevel(): Promise<
  { level: string; count: number }[]
> {
  const result = await pool.query<{ level: string; count: number }>(
    'SELECT level, COUNT(*)::int AS count FROM system_logs GROUP BY level'
  );
  return result.rows;
}

export async function countSystemLogsSince(since: Date, level?: string): Promise<number> {
  if (level) {
    const result = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM system_logs WHERE timestamp >= $1 AND level = $2',
      [since, level]
    );
    return result.rows[0].count;
  }
  const result = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM system_logs WHERE timestamp >= $1',
    [since]
  );
  return result.rows[0].count;
}
