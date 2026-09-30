import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { ingestDocument, listDocuments, getDocument, removeDocument } from '../../src/services/documents.js';
import { createUser } from '../../src/repositories/user.js';
import { createConversation } from '../../src/repositories/conversation.js';
import { findDocumentById } from '../../src/repositories/document.js';
import { searchSimilarChunks } from '../../src/repositories/chunk.js';
import { truncateAll, makeVector } from '../helpers/db.js';
import { EMBED_VECTOR, mockDefaultWorkerBehavior } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));

describe('documents service', () => {
  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);
  });
  afterAll(() => pool.end());

  const input = {
    title: 'My doc',
    source_type: 'upload',
    metadata: { tag: 'x' },
    chunks: [
      { content: 'chunk one', chunk_index: 0 },
      { content: 'chunk two', chunk_index: 1 },
    ],
  };

  it('ingests a document with embedded chunks linked to the conversation', async () => {
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') return payload.input!.map(() => EMBED_VECTOR);
      throw new Error('chat should not be called');
    });

    const user = await createUser('alice', 'hash');
    const conv = await createConversation(user.id, 'chat');

    const { document, chunks } = await ingestDocument(user.id, conv.id, input);

    expect(document.title).toBe('My doc');
    expect(document.conversation_id).toBe(conv.id);
    expect(chunks.length).toBe(2);

    const hits = await searchSimilarChunks(conv.id, user.id, EMBED_VECTOR, 5);
    expect(hits.map((h) => h.chunk.content)).toEqual(['chunk one', 'chunk two']);
  });

  it('embeds large documents in multiple batches', async () => {
    const calls: { input: string[] }[] = [];
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') {
        calls.push(payload);
        return payload.input!.map(() => EMBED_VECTOR);
      }
      return 'x';
    });

    const user = await createUser('bob', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const big = {
      title: 'Big',
      chunks: Array.from({ length: 120 }, (_, i) => ({
        content: `chunk ${i}`.padEnd(500, 'x'),
        chunk_index: i,
      })),
    };

    const { chunks } = await ingestDocument(user.id, conv.id, big);
    expect(chunks.length).toBe(120);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.flatMap((c) => c.input)).toHaveLength(120);
  });

  it('rejects when the conversation does not belong to the user', async () => {
    const owner = await createUser('carol', 'hash');
    const intruder = await createUser('dave', 'hash');
    const conv = await createConversation(owner.id, 'private');

    await expect(ingestDocument(intruder.id, conv.id, input)).rejects.toThrow(
      'Conversation not found'
    );
  });

  it('cleans up the orphaned document when embedding fails', async () => {
    workerMock.rpc.mockRejectedValue(new Error('embedding service down'));

    const user = await createUser('erin', 'hash');
    const conv = await createConversation(user.id, 'chat');

    await expect(ingestDocument(user.id, conv.id, input)).rejects.toThrow(
      'embedding service down'
    );
    const { documents } = await listDocuments(user.id, {});
    expect(documents).toEqual([]);
  });

  it('lists documents with pagination and conversation filter', async () => {
    const user = await createUser('frank', 'hash');
    const convA = await createConversation(user.id, 'A');
    const convB = await createConversation(user.id, 'B');
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') return payload.input!.map(() => EMBED_VECTOR);
      return 'x';
    });

    await ingestDocument(user.id, convA.id, { title: 'a1', chunks: [{ content: 'x', chunk_index: 0 }] });
    await ingestDocument(user.id, convA.id, { title: 'a2', chunks: [{ content: 'x', chunk_index: 0 }] });
    await ingestDocument(user.id, convB.id, { title: 'b1', chunks: [{ content: 'x', chunk_index: 0 }] });

    const all = await listDocuments(user.id, { limit: 2, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.documents.length).toBe(2);

    const filtered = await listDocuments(user.id, { conversationId: convA.id });
    expect(filtered.total).toBe(2);
  });

  it('gets a document with chunks, optionally including embeddings', async () => {
    const user = await createUser('grace', 'hash');
    const conv = await createConversation(user.id, 'chat');
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') return payload.input!.map(() => EMBED_VECTOR);
      return 'x';
    });
    const { document } = await ingestDocument(user.id, conv.id, {
      title: 'doc',
      chunks: [{ content: 'one', chunk_index: 0 }],
    });

    const light = await getDocument(user.id, document.id);
    expect('embedding' in light.chunks[0]).toBe(false);

    const full = await getDocument(user.id, document.id, true);
    expect(full.chunks[0].embedding).toEqual(EMBED_VECTOR);
  });

  it('throws for documents of other users', async () => {
    const owner = await createUser('heidi', 'hash');
    const other = await createUser('ivan', 'hash');
    const conv = await createConversation(owner.id, 'chat');
    const { document } = await ingestDocument(owner.id, conv.id, {
      title: 'mine',
      chunks: [{ content: 'x', chunk_index: 0 }],
    });

    await expect(getDocument(other.id, document.id)).rejects.toThrow('Document not found');
    await expect(removeDocument(other.id, document.id)).rejects.toThrow('Document not found');
  });

  it('removes a document and its chunks', async () => {
    const user = await createUser('judy', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const { document } = await ingestDocument(user.id, conv.id, {
      title: 'doomed',
      chunks: [{ content: 'x', chunk_index: 0 }],
    });

    await removeDocument(user.id, document.id);
    expect(await findDocumentById(document.id, user.id)).toBeUndefined();
    expect(await searchSimilarChunks(conv.id, user.id, EMBED_VECTOR, 5)).toEqual([]);
  });

  it('uses a single embedding vector per chunk regardless of batch boundaries', async () => {
    const user = await createUser('kevin', 'hash');
    const conv = await createConversation(user.id, 'chat');
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') return payload.input!.map(() => makeVector(0.42));
      return 'x';
    });

    const { chunks } = await ingestDocument(user.id, conv.id, {
      title: 'vecs',
      chunks: Array.from({ length: 60 }, (_, i) => ({ content: `c${i}`, chunk_index: i })),
    });
    expect(chunks[59].embedding).toEqual(makeVector(0.42));
  });
});
