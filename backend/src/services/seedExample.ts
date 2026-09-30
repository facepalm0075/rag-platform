import { createConversation } from '../repositories/conversation.js';
import { createDocument } from '../repositories/document.js';
import { createChunks } from '../repositories/chunk.js';
import { findExampleEmbedding } from '../repositories/exampleEmbedding.js';
import { workerPool } from './workerPool.js';
import { config } from '../config/index.js';
import { EXAMPLE_CONVERSATION_TITLE, EXAMPLE_DOCUMENT_TITLE, EXAMPLE_CHUNKS } from '../seed/exampleData.js';

async function loadStoredEmbeddings(): Promise<number[][] | null> {
  const row = await findExampleEmbedding();
  if (!row) return null;

  if (!Array.isArray(row.embeddings) || row.embeddings.length !== EXAMPLE_CHUNKS.length) {
    return null;
  }
  if (row.dimension !== config.VECTOR_DIMENSION) {
    console.warn(
      `Example embeddings dimension (${row.dimension}) does not match VECTOR_DIMENSION (${config.VECTOR_DIMENSION}); ignoring stored embeddings.`
    );
    return null;
  }

  return row.embeddings;
}

export async function seedExampleData(userId: string): Promise<void> {
  try {
    const conversation = await createConversation(userId, EXAMPLE_CONVERSATION_TITLE);

    const doc = await createDocument(userId, conversation.id, EXAMPLE_DOCUMENT_TITLE, 'seed', {
      isExample: true,
    });

    const storedEmbeddings = await loadStoredEmbeddings();
    if (storedEmbeddings) {
      await createChunks(doc.id, EXAMPLE_CHUNKS, storedEmbeddings);
      return;
    }

    const texts = EXAMPLE_CHUNKS.map((c) => c.content);
    const embeddings = (await workerPool.rpc('embed', { input: texts })) as number[][];
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      console.warn('Example embedding response does not match chunk count; skipping chunk creation.');
      return;
    }
    await createChunks(doc.id, EXAMPLE_CHUNKS, embeddings);
  } catch (err) {
    console.error('Failed to seed example data for user:', userId, err);
  }
}