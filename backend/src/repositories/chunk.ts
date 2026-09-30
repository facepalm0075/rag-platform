import { pool } from '../db/pool.js';
import { Chunk, ChunkInput, SearchResult } from '../types/index.js';

function parseVector(value: unknown): number[] | undefined {
  if (typeof value !== 'string') return undefined;
  const inner = value.slice(1, -1);
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}

interface ChunkRow {
  id: string;
  document_id: string;
  content: string;
  embedding?: unknown;
  chunk_index: number;
  heading: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function toChunk(row: ChunkRow): Chunk {
  const chunk: Chunk = {
    id: row.id,
    document_id: row.document_id,
    content: row.content,
    chunk_index: row.chunk_index,
    heading: row.heading,
    metadata: row.metadata,
    created_at: row.created_at,
  };
  if (row.embedding !== undefined) {
    chunk.embedding = typeof row.embedding === 'string' ? parseVector(row.embedding) : (row.embedding as number[] | undefined);
  }
  return chunk;
}

export async function createChunks(
  documentId: string,
  chunks: ChunkInput[],
  embeddings: number[][]
): Promise<Chunk[]> {
  if (chunks.length === 0) return [];

  const values: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const paramIndex = params.length + 1;
    values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`);
    params.push(
      documentId,
      chunks[i].content,
      `[${embeddings[i].join(',')}]`,
      chunks[i].chunk_index,
      chunks[i].heading ?? null,
      JSON.stringify(chunks[i].metadata ?? {})
    );
  }

  const result = await pool.query<ChunkRow>(
    `INSERT INTO chunks (document_id, content, embedding, chunk_index, heading, metadata) VALUES ${values.join(', ')} RETURNING *`,
    params
  );
  return result.rows.map(toChunk);
}

export async function findChunksByDocumentId(
  documentId: string,
  includeEmbeddings = false
): Promise<Chunk[]> {
  const select = includeEmbeddings
    ? 'SELECT *'
    : 'SELECT id, document_id, content, heading, chunk_index, metadata, created_at';
  const result = await pool.query<ChunkRow>(
    `${select} FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
    [documentId]
  );
  return result.rows.map(toChunk);
}

export async function deleteChunksByDocumentId(documentId: string): Promise<void> {
  await pool.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
}

export interface ConversationChunk extends Chunk {
  document_title: string;
}

export async function findChunksByConversationId(
  conversationId: string,
  options: { limit: number; offset: number }
): Promise<{ rows: ConversationChunk[]; total: number }> {
  const result = await pool.query<ConversationChunk & { total: number }>(
    `SELECT c.id, c.document_id, d.title AS document_title, c.content, c.heading, c.chunk_index,
            c.metadata, c.created_at, COUNT(*) OVER()::int AS total
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE d.conversation_id = $1
     ORDER BY d.title, c.chunk_index
     LIMIT $2 OFFSET $3`,
    [conversationId, options.limit, options.offset]
  );
  const total = result.rows.length > 0 ? result.rows[0].total : 0;
  return { rows: result.rows, total };
}

export async function searchSimilarChunks(
  conversationId: string,
  userId: string,
  embedding: number[],
  limit: number = 5
): Promise<SearchResult[]> {
  const result = await pool.query<ChunkRow & { distance: number }>(
    `SELECT c.id, c.document_id, c.content, c.heading, c.chunk_index, c.metadata, c.created_at,
            c.embedding <=> $3::vector AS distance
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN conversations cv ON cv.id = d.conversation_id
     WHERE cv.id = $2 AND cv.user_id = $1 AND c.embedding IS NOT NULL
     ORDER BY distance
     LIMIT $4`,
    [userId, conversationId, `[${embedding.join(',')}]`, limit]
  );
  return result.rows.map(({ distance, ...row }) => ({ chunk: toChunk(row), distance }));
}