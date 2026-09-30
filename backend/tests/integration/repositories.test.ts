import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { createUser, findUserByUsername, findUserById } from '../../src/repositories/user.js';
import {
  createSession,
  findSessionByToken,
  deleteSessionByToken,
  deleteSessionsByUserId,
  deleteExpiredSessions,
} from '../../src/repositories/session.js';
import {
  createConversation,
  findConversationsByUserId,
  findConversationById,
  updateConversationTitle,
  deleteConversationById,
} from '../../src/repositories/conversation.js';
import {
  createMessage,
  findMessagesByConversationId,
  findMessagesWithTotal,
  findLastMessagesByConversationId,
} from '../../src/repositories/message.js';
import {
  createDocument,
  findDocumentsByUserId,
  findDocumentById,
  deleteDocumentById,
} from '../../src/repositories/document.js';
import {
  createChunks,
  findChunksByDocumentId,
  findChunksByConversationId,
  searchSimilarChunks,
} from '../../src/repositories/chunk.js';
import { truncateAll, makeVector } from '../helpers/db.js';

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

describe('users repository', () => {
  beforeEach(truncateAll);

  it('creates and finds a user by username and id', async () => {
    const user = await createUser('alice', 'hash');
    expect(user.username).toBe('alice');

    const byName = await findUserByUsername('alice');
    expect(byName?.id).toBe(user.id);

    const byId = await findUserById(user.id);
    expect(byId?.username).toBe('alice');
  });

  it('enforces unique usernames', async () => {
    await createUser('bob', 'hash1');
    await expect(createUser('bob', 'hash2')).rejects.toThrow();
  });

  it('returns undefined for unknown users', async () => {
    expect(await findUserByUsername('nobody')).toBeUndefined();
    expect(await findUserById('00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });
});

describe('sessions repository', () => {
  beforeEach(truncateAll);
  
  it('creates and finds a valid session with username join', async () => {
    const user = await createUser('carol', 'hash');
    await createSession(user.id, 'token-123', daysFromNow(30));

    const session = await findSessionByToken('token-123');
    expect(session?.user_id).toBe(user.id);
    expect(session?.username).toBe('carol');
  });

  it('returns undefined for expired sessions', async () => {
    const user = await createUser('dave', 'hash');
    await createSession(user.id, 'expired-token', daysFromNow(-1));
    expect(await findSessionByToken('expired-token')).toBeUndefined();
  });

  it('deletes a session by token', async () => {
    const user = await createUser('erin', 'hash');
    await createSession(user.id, 'tok', daysFromNow(30));
    await deleteSessionByToken('tok');
    expect(await findSessionByToken('tok')).toBeUndefined();
  });

  it('deletes all sessions for a user', async () => {
    const user = await createUser('frank', 'hash');
    await createSession(user.id, 't1', daysFromNow(30));
    await createSession(user.id, 't2', daysFromNow(30));
    await deleteSessionsByUserId(user.id);
    expect(await findSessionByToken('t1')).toBeUndefined();
    expect(await findSessionByToken('t2')).toBeUndefined();
  });

  it('purges only sessions expired beyond the grace period', async () => {
    const user = await createUser('grace', 'hash');
    await createSession(user.id, 'old', daysFromNow(-10));
    await createSession(user.id, 'recent', daysFromNow(5));

    const deleted = await deleteExpiredSessions(7);
    expect(deleted).toBe(1);
    expect(await findSessionByToken('old')).toBeUndefined();
    expect(await findSessionByToken('recent')).not.toBeUndefined();
  });
});

describe('conversations repository', () => {
  beforeEach(truncateAll);
  
  it('creates and finds a conversation scoped to its owner', async () => {
    const user = await createUser('hank', 'hash');
    const other = await createUser('ivy', 'hash');
    const conv = await createConversation(user.id, 'My chat');

    expect(await findConversationById(conv.id, user.id)).toMatchObject({
      id: conv.id,
      title: 'My chat',
    });
    expect(await findConversationById(conv.id, other.id)).toBeUndefined();
  });

  it('lists conversations ordered by updated_at desc with total', async () => {
    const user = await createUser('jack', 'hash');
    const first = await createConversation(user.id, 'older');
    await new Promise((r) => setTimeout(r, 10));
    const second = await createConversation(user.id, 'newer');

    const { conversations, total } = await findConversationsByUserId(user.id, {
      limit: 10,
      offset: 0,
    });
    expect(total).toBe(2);
    expect(conversations.map((c) => c.id)).toEqual([second.id, first.id]);

    const page = await findConversationsByUserId(user.id, { limit: 1, offset: 1 });
    expect(page.conversations.map((c) => c.id)).toEqual([first.id]);
    expect(page.total).toBe(2);
  });

  it('renames a conversation', async () => {
    const user = await createUser('kim', 'hash');
    const conv = await createConversation(user.id, 'old');
    const updated = await updateConversationTitle(conv.id, user.id, 'new');
    expect(updated?.title).toBe('new');
  });

  it('deletes a conversation and cascades messages', async () => {
    const user = await createUser('leo', 'hash');
    const conv = await createConversation(user.id, 'doomed');
    await createMessage(conv.id, 'user', 'hello');
    await deleteConversationById(conv.id, user.id);

    expect(await findConversationById(conv.id, user.id)).toBeUndefined();
    const { total } = await findMessagesWithTotal(conv.id, { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });
});

describe('messages repository', () => {
  beforeEach(truncateAll);
  
  it('creates messages and touches the conversation updated_at via trigger', async () => {
    const user = await createUser('mia', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const before = (await findConversationById(conv.id, user.id))!.updated_at;
    await new Promise((r) => setTimeout(r, 10));

    const msg = await createMessage(conv.id, 'user', 'question');
    expect(msg.role).toBe('user');

    const after = (await findConversationById(conv.id, user.id))!.updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('finds messages with limit/offset and a window total', async () => {
    const user = await createUser('noah', 'hash');
    const conv = await createConversation(user.id, 'chat');
    for (let i = 0; i < 5; i++) {
      await createMessage(conv.id, i % 2 === 0 ? 'user' : 'assistant', `m${i}`);
    }

    const { rows, total } = await findMessagesWithTotal(conv.id, { limit: 2, offset: 2 });
    expect(total).toBe(5);
    expect(rows.map((m) => m.content)).toEqual(['m2', 'm3']);
  });

  it('returns the last N messages in chronological order', async () => {
    const user = await createUser('olive', 'hash');
    const conv = await createConversation(user.id, 'chat');
    for (let i = 0; i < 15; i++) {
      await createMessage(conv.id, 'user', `m${i}`);
    }

    const last = await findLastMessagesByConversationId(conv.id, 10);
    expect(last.map((m) => m.content)).toEqual([
      'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14',
    ]);
  });

  it('findMessagesByConversationId defaults to a 1000-row cap', async () => {
    const user = await createUser('pete', 'hash');
    const conv = await createConversation(user.id, 'chat');
    for (let i = 0; i < 5; i++) await createMessage(conv.id, 'user', `m${i}`);
    const all = await findMessagesByConversationId(conv.id);
    expect(all.length).toBe(5);
  });
});

describe('documents repository', () => {
  beforeEach(truncateAll);
  
  it('creates a document linked to a conversation', async () => {
    const user = await createUser('quinn', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const doc = await createDocument(user.id, conv.id, 'Doc A', 'upload', { isExample: false });

    expect(doc.conversation_id).toBe(conv.id);
    const found = await findDocumentById(doc.id, user.id);
    expect(found?.title).toBe('Doc A');
  });

  it('lists documents with pagination, total, and conversation filter', async () => {
    const user = await createUser('rose', 'hash');
    const convA = await createConversation(user.id, 'A');
    const convB = await createConversation(user.id, 'B');
    await createDocument(user.id, convA.id, 'd1', null, {});
    await createDocument(user.id, convA.id, 'd2', null, {});
    await createDocument(user.id, convB.id, 'd3', null, {});

    const all = await findDocumentsByUserId(user.id, { limit: 10, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.documents.map((d) => d.title)).toEqual(['d3', 'd2', 'd1']);

    const filtered = await findDocumentsByUserId(user.id, {
      limit: 10,
      offset: 0,
      conversationId: convA.id,
    });
    expect(filtered.total).toBe(2);
    expect(filtered.documents.map((d) => d.title)).toEqual(['d2', 'd1']);
  });

  it('is user-scoped', async () => {
    const user = await createUser('sam', 'hash');
    const other = await createUser('tina', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const doc = await createDocument(user.id, conv.id, 'mine', null, {});
    expect(await findDocumentById(doc.id, other.id)).toBeUndefined();
  });

  it('cascades document deletion to chunks', async () => {
    const user = await createUser('uma', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const doc = await createDocument(user.id, conv.id, 'doomed', null, {});
    await createChunks(doc.id, [{ content: 'one', chunk_index: 0 }], [makeVector(1)]);

    await deleteDocumentById(doc.id, user.id);
    expect(await findChunksByDocumentId(doc.id)).toEqual([]);
  });

  it('cascades conversation deletion to its documents and chunks', async () => {
    const user = await createUser('vic', 'hash');
    const conv = await createConversation(user.id, 'doomed');
    const doc = await createDocument(user.id, conv.id, 'doc', null, {});
    await createChunks(doc.id, [{ content: 'one', chunk_index: 0 }], [makeVector(1)]);

    await deleteConversationById(conv.id, user.id);
    expect(await findDocumentById(doc.id, user.id)).toBeUndefined();
    expect(await findChunksByConversationId(conv.id, { limit: 10, offset: 0 })).toEqual({
      rows: [],
      total: 0,
    });
  });
});

describe('chunks repository', () => {
  beforeEach(truncateAll);
  
  async function seedUserWithDocAndChunks() {
    const user = await createUser('will', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const doc = await createDocument(user.id, conv.id, 'Doc', null, {});
    const chunks = await createChunks(
      doc.id,
      [
        { content: 'alpha', chunk_index: 0, heading: 'H1' },
        { content: 'beta', chunk_index: 1 },
        { content: 'gamma', chunk_index: 2, heading: 'H3' },
      ],
      [makeVector(1), makeVector(-1), makeVector(0.5)]
    );
    return { user, conv, doc, chunks };
  }

  it('creates chunks in a single batched insert', async () => {
    const { chunks } = await seedUserWithDocAndChunks();
    expect(chunks.length).toBe(3);
    expect(chunks[0].heading).toBe('H1');
    expect(chunks[1].heading).toBeNull();
  });

  it('omits embeddings by default and includes them on request', async () => {
    const { doc } = await seedUserWithDocAndChunks();
    const light = await findChunksByDocumentId(doc.id);
    expect('embedding' in light[0]).toBe(false);

    const full = await findChunksByDocumentId(doc.id, true);
    expect(full[0].embedding).toEqual(makeVector(1));
  });

  it('lists chunks for a conversation with document titles and total', async () => {
    const { user, conv } = await seedUserWithDocAndChunks();
    const otherConv = await createConversation(user.id, 'other');
    await createDocument(user.id, otherConv.id, 'Other doc', null, {});

    const { rows, total } = await findChunksByConversationId(conv.id, {
      limit: 10,
      offset: 0,
    });
    expect(total).toBe(3);
    expect(rows.map((r) => r.content)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows[0].document_title).toBe('Doc');
    expect(rows[0].heading).toBe('H1');
  });

  it('paginates conversation chunks', async () => {
    const { conv } = await seedUserWithDocAndChunks();
    const { rows, total } = await findChunksByConversationId(conv.id, {
      limit: 2,
      offset: 1,
    });
    expect(total).toBe(3);
    expect(rows.map((r) => r.content)).toEqual(['beta', 'gamma']);
  });

  it('ranks chunks by cosine distance', async () => {
    const { user, conv } = await seedUserWithDocAndChunks();
    const results = await searchSimilarChunks(conv.id, user.id, makeVector(1), 3);
    expect(results[0].chunk.content).toBe('alpha');
    expect(results[2].chunk.content).toBe('beta');
    expect(results[0].distance).toBeLessThan(results[2].distance);
  });

  it('excludes chunks without embeddings from search', async () => {
    const user = await createUser('xena', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const doc = await createDocument(user.id, conv.id, 'Doc', null, {});
    await createChunks(doc.id, [{ content: 'plain', chunk_index: 0 }], [makeVector(1)]);
    await pool.query('UPDATE chunks SET embedding = NULL WHERE content = $1', ['plain']);

    const results = await searchSimilarChunks(conv.id, user.id, makeVector(1), 5);
    expect(results).toEqual([]);
  });

  it('scopes search to the conversation', async () => {
    const user = await createUser('yuri', 'hash');
    const convA = await createConversation(user.id, 'A');
    const convB = await createConversation(user.id, 'B');
    const docA = await createDocument(user.id, convA.id, 'Doc A', null, {});
    await createChunks(docA.id, [{ content: 'in A', chunk_index: 0 }], [makeVector(1)]);

    const inA = await searchSimilarChunks(convA.id, user.id, makeVector(1), 5);
    expect(inA.map((r) => r.chunk.content)).toEqual(['in A']);

    const inB = await searchSimilarChunks(convB.id, user.id, makeVector(1), 5);
    expect(inB).toEqual([]);
  });

  it('scopes search to the owning user even with a known conversation id', async () => {
    const owner = await createUser('zack', 'hash');
    const intruder = await createUser('amy', 'hash');
    const conv = await createConversation(owner.id, 'private');
    const doc = await createDocument(owner.id, conv.id, 'Secret', null, {});
    await createChunks(doc.id, [{ content: 'secret', chunk_index: 0 }], [makeVector(1)]);

    const results = await searchSimilarChunks(conv.id, intruder.id, makeVector(1), 5);
    expect(results).toEqual([]);
  });
});

afterAll(() => pool.end());
