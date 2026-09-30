import { pool } from '../db/pool.js';
import { Document } from '../types/index.js';

export async function createDocument(
  userId: string,
  conversationId: string,
  title: string,
  sourceType: string | null,
  metadata: Record<string, unknown>
): Promise<Document> {
  const result = await pool.query<Document>(
    'INSERT INTO documents (user_id, conversation_id, title, source_type, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [userId, conversationId, title, sourceType, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

export async function findDocumentsByUserId(
  userId: string,
  options?: { limit?: number; offset?: number; conversationId?: string }
): Promise<{ documents: Document[]; total: number }> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let result;
  if (options?.conversationId) {
    result = await pool.query<Document & { total: number }>(
      `SELECT d.*, COUNT(*) OVER()::int AS total
       FROM documents d
       WHERE user_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, options.conversationId, limit, offset]
    );
  } else {
    result = await pool.query<Document & { total: number }>(
      `SELECT d.*, COUNT(*) OVER()::int AS total
       FROM documents d
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  }

  const total = result.rows.length > 0 ? result.rows[0].total : 0;
  return { documents: result.rows, total };
}

export async function findDocumentById(id: string, userId: string): Promise<Document | undefined> {
  const result = await pool.query<Document>(
    'SELECT * FROM documents WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0];
}

export async function deleteDocumentById(id: string, userId: string): Promise<void> {
  await pool.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [id, userId]);
}