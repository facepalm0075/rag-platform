import { pool } from '../db/pool.js';
import { Conversation } from '../types/index.js';

export async function createConversation(userId: string, title: string): Promise<Conversation> {
  const result = await pool.query<Conversation>(
    'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *',
    [userId, title]
  );
  return result.rows[0];
}

export async function findConversationsByUserId(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ conversations: Conversation[]; total: number }> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const result = await pool.query<Conversation & { total: number }>(
    `SELECT c.*, COUNT(*) OVER()::int AS total
     FROM conversations c
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const total = result.rows.length > 0 ? result.rows[0].total : 0;
  return { conversations: result.rows, total };
}

export async function findConversationById(id: string, userId: string): Promise<Conversation | undefined> {
  const result = await pool.query<Conversation>(
    'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0];
}

export async function updateConversationTitle(id: string, userId: string, title: string): Promise<Conversation | undefined> {
  const result = await pool.query<Conversation>(
    'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
    [title, id, userId]
  );
  return result.rows[0];
}

export async function deleteConversationById(id: string, userId: string): Promise<void> {
  await pool.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [id, userId]);
}