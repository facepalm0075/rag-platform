import { pool } from '../db/pool.js';
import { Message } from '../types/index.js';

export async function createMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message> {
  const result = await pool.query<Message>(
    'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING *',
    [conversationId, role, content]
  );
  return result.rows[0];
}

export async function findMessagesByConversationId(
  conversationId: string,
  options?: { limit?: number; offset?: number }
): Promise<Message[]> {
  const limit = options?.limit ?? 1000;
  const offset = options?.offset ?? 0;
  const result = await pool.query<Message>(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at LIMIT $2 OFFSET $3',
    [conversationId, limit, offset]
  );
  return result.rows;
}

export async function findMessagesWithTotal(
  conversationId: string,
  options: { limit: number; offset: number }
): Promise<{ rows: Message[]; total: number }> {
  const result = await pool.query<Message & { total: number }>(
    `SELECT m.*, COUNT(*) OVER()::int AS total
     FROM messages m
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [conversationId, options.limit, options.offset]
  );
  const total = result.rows.length > 0 ? result.rows[0].total : 0;
  return { rows: result.rows.reverse(), total };
}

export async function findLatestMessagesWithTotal(
  conversationId: string,
  limit: number
): Promise<{ rows: Message[]; total: number }> {
  const result = await pool.query<Message & { total: number }>(
    `SELECT m.*, COUNT(*) OVER()::int AS total
     FROM messages m
     WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  const total = result.rows.length > 0 ? result.rows[0].total : 0;
  return { rows: result.rows.reverse(), total };
}

export async function findLastMessagesByConversationId(
  conversationId: string,
  limit: number
): Promise<Message[]> {
  const result = await pool.query<Message>(
    `SELECT * FROM messages WHERE conversation_id = $1 AND role != 'system' ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.reverse();
}