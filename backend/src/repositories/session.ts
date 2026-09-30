import { pool } from '../db/pool.js';
import { Session } from '../types/index.js';

export async function createSession(userId: string, token: string, expiresAt: Date): Promise<Session> {
  const result = await pool.query<Session>(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING *',
    [userId, token, expiresAt]
  );
  return result.rows[0];
}

export async function findSessionByToken(token: string): Promise<(Session & { username: string }) | undefined> {
  const result = await pool.query<(Session & { username: string })>(
    `SELECT s.*, u.username FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  return result.rows[0];
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function deleteSessionsByUserId(userId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function deleteExpiredSessions(graceDays: number): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'DELETE FROM sessions WHERE expires_at < NOW() - make_interval(days => $1) RETURNING id',
    [graceDays]
  );
  return result.rowCount ?? 0;
}
