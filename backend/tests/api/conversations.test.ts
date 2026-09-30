import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { registerUser } from '../helpers/http.js';
import { truncateAll } from '../helpers/db.js';
import { mockDefaultWorkerBehavior } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));
vi.mock('../../src/services/seedExample.js', () => ({
  seedExampleData: vi.fn().mockResolvedValue(undefined),
}));

describe('conversations API', () => {
  let token: string;

  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);
    const auth = await registerUser(app, `convuser${Date.now()}`);
    token = auth.token;
  });
  afterAll(() => pool.end());

  async function createConversation(title = 'New chat') {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title });
    return res.body.conversation;
  }

  it('creates a conversation with a default title', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.conversation.title).toBe('New conversation');
  });

  it('lists conversations ordered by recency with pagination metadata', async () => {
    const a = await createConversation('older');
    await new Promise((r) => setTimeout(r, 10));
    const b = await createConversation('newer');

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([b.id, a.id]);
    expect(res.body.total).toBe(2);

    const page = await request(app)
      .get('/api/conversations?limit=1&offset=1')
      .set('Authorization', `Bearer ${token}`);
    expect(page.body.conversations.map((c: { id: string }) => c.id)).toEqual([a.id]);
    expect(page.body.total).toBe(2);
  });

  it('renames a conversation', async () => {
    const conv = await createConversation('old name');
    const res = await request(app)
      .patch(`/api/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'new name' });
    expect(res.status).toBe(200);
    expect(res.body.conversation.title).toBe('new name');
  });

  it('gets a conversation with messages, capped at 100 by default', async () => {
    const conv = await createConversation('chat');
    for (let i = 0; i < 3; i++) {
      await pool.query('INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)', [
        conv.id,
        i % 2 === 0 ? 'user' : 'assistant',
        `msg ${i}`,
      ]);
    }

    const res = await request(app)
      .get(`/api/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'msg 0', 'msg 1', 'msg 2',
    ]);
    expect(res.body.total).toBe(3);
  });

  it('supports from/to message ranges', async () => {
    const conv = await createConversation('chat');
    for (let i = 0; i < 10; i++) {
      await pool.query('INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)', [
        conv.id,
        'user',
        `msg ${i}`,
      ]);
    }

    const res = await request(app)
      .get(`/api/conversations/${conv.id}?from=3&to=5`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'msg 2', 'msg 3', 'msg 4',
    ]);
    expect(res.body.total).toBe(10);
  });

  it('rejects invalid from/to combos', async () => {
    const conv = await createConversation('chat');
    const onlyFrom = await request(app)
      .get(`/api/conversations/${conv.id}?from=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(onlyFrom.status).toBe(400);

    const inverted = await request(app)
      .get(`/api/conversations/${conv.id}?from=5&to=2`)
      .set('Authorization', `Bearer ${token}`);
    expect(inverted.status).toBe(400);
  });

  it('scopes conversation access to the owner', async () => {
    const conv = await createConversation('mine');
    const other = await registerUser(app, `snoop${Date.now()}`);

    const res = await request(app)
      .get(`/api/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });

  it('lists the chunks of every document attached to the conversation', async () => {
    const conv = await createConversation('knowledge');
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'guide',
        conversation_id: conv.id,
        chunks: [
          { content: 'part A', chunk_index: 0, heading: 'Section 1' },
          { content: 'part B', chunk_index: 1 },
        ],
      });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/chunks`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe(conv.id);
    expect(res.body.total).toBe(2);
    expect(res.body.chunks[0]).toMatchObject({
      document_title: 'guide',
      heading: 'Section 1',
      content: 'part A',
    });
    expect(res.body.chunks[0]).not.toHaveProperty('embedding');
  });

  it('paginates conversation chunks', async () => {
    const conv = await createConversation('knowledge');
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'guide',
        conversation_id: conv.id,
        chunks: [
          { content: 'a', chunk_index: 0 },
          { content: 'b', chunk_index: 1 },
          { content: 'c', chunk_index: 2 },
        ],
      });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/chunks?limit=2&offset=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(3);
    expect(res.body.chunks.map((c: { content: string }) => c.content)).toEqual(['b', 'c']);
  });

  it('returns an empty chunk list for conversations without documents', async () => {
    const conv = await createConversation('empty');
    const res = await request(app)
      .get(`/api/conversations/${conv.id}/chunks`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.chunks).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('deletes a conversation and cascades its documents and chunks', async () => {
    const conv = await createConversation('doomed');
    const doc = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'attached',
        conversation_id: conv.id,
        chunks: [{ content: 'x', chunk_index: 0 }],
      });

    const del = await request(app)
      .delete(`/api/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const docGone = await request(app)
      .get(`/api/documents/${doc.body.document.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(docGone.status).toBe(404);
  });
});
