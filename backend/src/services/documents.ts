import { createDocument, findDocumentsByUserId, findDocumentById, deleteDocumentById } from '../repositories/document.js';
import { findConversationById } from '../repositories/conversation.js';
import { createChunks, findChunksByDocumentId } from '../repositories/chunk.js';
import { workerPool } from './workerPool.js';
import { ApiError } from '../errors.js';
import { IngestDocumentInput, Document, Chunk } from '../types/index.js';
import { log } from '../logging/index.js';

const EMBED_BATCH_SIZE = 50;
const EMBED_BATCH_CHARS = 8000;

export function buildEmbedBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const text of texts) {
    if (current.length > 0 && (current.length >= EMBED_BATCH_SIZE || currentChars + text.length > EMBED_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const batches = buildEmbedBatches(texts);
  const all: number[][] = [];
  for (const batch of batches) {
    const embeddings = (await workerPool.rpc('embed', { input: batch })) as number[][];
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
      throw new Error('Embedding response does not match batch count');
    }
    all.push(...embeddings);
  }
  return all;
}

export async function ingestDocument(
  userId: string,
  conversationId: string,
  input: IngestDocumentInput
): Promise<{ document: Document; chunks: Chunk[] }> {
  const conversation = await findConversationById(conversationId, userId);
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const doc = await createDocument(
    userId,
    conversationId,
    input.title,
    input.source_type ?? null,
    input.metadata ?? {}
  );

  try {
    const texts = input.chunks.map((c) => c.content);
    const embeddings = await embedTexts(texts);

    const chunks = await createChunks(
      doc.id,
      input.chunks,
      embeddings
    );

    log('info', 'Document ingested', {
      userId,
      conversationId,
      documentId: doc.id,
      title: input.title,
      chunkCount: chunks.length,
    }, 'documents');

    return { document: doc, chunks };
  } catch (err) {
    log('error', 'Document ingestion failed', {
      userId,
      conversationId,
      documentId: doc.id,
      title: input.title,
      message: err instanceof Error ? err.message : String(err),
    }, 'documents');
    await deleteDocumentById(doc.id, userId).catch(() => {});
    throw err;
  }
}

export async function listDocuments(userId: string, options?: { limit?: number; offset?: number; conversationId?: string }) {
  return findDocumentsByUserId(userId, options);
}

export async function getDocument(userId: string, id: string, includeEmbeddings = false) {
  const doc = await findDocumentById(id, userId);
  if (!doc) throw ApiError.notFound('Document not found');
  const chunks = await findChunksByDocumentId(id, includeEmbeddings);
  return { document: doc, chunks };
}

export async function removeDocument(userId: string, id: string) {
  const doc = await findDocumentById(id, userId);
  if (!doc) throw ApiError.notFound('Document not found');
  await deleteDocumentById(id, userId);
  log('info', 'Document deleted', { userId, documentId: id, title: doc.title }, 'documents');
}