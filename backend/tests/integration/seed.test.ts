import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { seedExampleData } from '../../src/services/seedExample.js';
import { createUser } from '../../src/repositories/user.js';
import { createExampleEmbedding, findExampleEmbedding } from '../../src/repositories/exampleEmbedding.js';
import { findConversationsByUserId } from '../../src/repositories/conversation.js';
import { findDocumentsByUserId } from '../../src/repositories/document.js';
import { findChunksByConversationId } from '../../src/repositories/chunk.js';
import { truncateAll, makeVector } from '../helpers/db.js';
import { mockDefaultWorkerBehavior } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));

describe('seedExampleData', () => {
  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);
  });
  afterAll(() => pool.end());

  it('creates an example conversation with a linked document and chunks from stored embeddings', async () => {
    await createExampleEmbedding({
      dimension: 768,
      source: 'test',
      model: 'test',
      embeddings: [makeVector(0.1), makeVector(0.2), makeVector(0.3), makeVector(0.4), makeVector(0.5)],
    });

    const user = await createUser('alice', 'hash');
    await seedExampleData(user.id);

    const { conversations } = await findConversationsByUserId(user.id, {});
    expect(conversations.length).toBe(1);
    const conv = conversations[0];

    const { documents } = await findDocumentsByUserId(user.id, { conversationId: conv.id });
    expect(documents.length).toBe(1);
    expect(documents[0].conversation_id).toBe(conv.id);

    const { rows, total } = await findChunksByConversationId(conv.id, { limit: 10, offset: 0 });
    expect(total).toBe(5);
    expect(rows.map((r) => r.content[0])).toEqual(['W', 'T', 'W', 'E', 'Y']);
    expect(workerMock.rpc).not.toHaveBeenCalled();
  });

  it('embeds via the worker when no stored embeddings exist', async () => {
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') return payload.input!.map(() => makeVector(0.1));
      throw new Error('chat should not be called');
    });

    const user = await createUser('bob', 'hash');
    await seedExampleData(user.id);

    expect(workerMock.rpc).toHaveBeenCalledTimes(1);
    expect(workerMock.rpc.mock.calls[0][0]).toBe('embed');

    const { conversations } = await findConversationsByUserId(user.id, {});
    const { rows, total } = await findChunksByConversationId(conversations[0].id, {
      limit: 10,
      offset: 0,
    });
    expect(total).toBe(5);
    expect(rows[0].content).toContain('Welcome to the RAG Assistant');
  });

  it('ignores stored embeddings with a mismatched dimension and re-embeds', async () => {
    await createExampleEmbedding({
      dimension: 4,
      source: 'test',
      model: 'test',
      embeddings: [makeVector(0.1, 4)],
    });
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') return payload.input!.map(() => makeVector(0.1));
      throw new Error('chat should not be called');
    });

    const user = await createUser('carol', 'hash');
    await seedExampleData(user.id);
    expect(workerMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('creates the document but skips chunks when embedding fails', async () => {
    workerMock.rpc.mockRejectedValue(new Error('worker down'));

    const user = await createUser('dave', 'hash');
    await seedExampleData(user.id);

    const { conversations } = await findConversationsByUserId(user.id, {});
    const { documents } = await findDocumentsByUserId(user.id, { conversationId: conversations[0].id });
    expect(documents.length).toBe(1);

    const { rows, total } = await findChunksByConversationId(conversations[0].id, {
      limit: 10,
      offset: 0,
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it('does not throw when embedding fails, leaving the conversation intact', async () => {
    workerMock.rpc.mockRejectedValue(new Error('worker down'));

    const user = await createUser('erin', 'hash');
    await expect(seedExampleData(user.id)).resolves.toBeUndefined();
    const { conversations } = await findConversationsByUserId(user.id, {});
    expect(conversations.length).toBe(1);
  });

  it('stored embeddings are reusable across users without re-embedding', async () => {
    await createExampleEmbedding({
      dimension: 768,
      source: 'test',
      model: 'test',
      embeddings: [makeVector(0.1), makeVector(0.2), makeVector(0.3), makeVector(0.4), makeVector(0.5)],
    });
    workerMock.rpc.mockRejectedValue(new Error('should not be called'));

    const a = await createUser('frank', 'hash');
    const b = await createUser('grace', 'hash');
    await seedExampleData(a.id);
    await seedExampleData(b.id);

    expect(workerMock.rpc).not.toHaveBeenCalled();
    expect(await findExampleEmbedding()).not.toBeUndefined();
  });
});
