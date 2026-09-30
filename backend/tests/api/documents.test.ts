import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { registerUser } from '../helpers/http.js';
import { truncateAll, waitFor } from '../helpers/db.js';
import { mockDefaultWorkerBehavior, EMBED_VECTOR } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));
vi.mock('../../src/services/seedExample.js', () => ({
  seedExampleData: vi.fn().mockResolvedValue(undefined),
}));

describe('documents API', () => {
  let token: string;
  let conversationId: string;

  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);

    const auth = await registerUser(app, `docuser${Date.now()}`);
    token = auth.token;

    const conv = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Chat' });
    conversationId = conv.body.conversation.id;
  });
  afterAll(() => pool.end());

  function ingestBody(overrides: Record<string, unknown> = {}) {
    return {
      title: 'My document',
      conversation_id: conversationId,
      chunks: [
        { content: 'chunk one', chunk_index: 0, heading: 'Intro' },
        { content: 'chunk two', chunk_index: 1 },
      ],
      ...overrides,
    };
  }

  it('ingests a document with chunks for a conversation', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody());

    expect(res.status).toBe(201);
    expect(res.body.document.conversation_id).toBe(conversationId);
    expect(res.body.chunks).toHaveLength(2);
    expect(res.body.chunks[0].heading).toBe('Intro');
    expect(res.body.chunks[0]).not.toHaveProperty('embedding');
  });

  it('requires a conversation_id', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'No conv', chunks: [{ content: 'x', chunk_index: 0 }] });

    expect(res.status).toBe(400);
  });

  it('rejects ingest into another user\'s conversation', async () => {
    const other = await registerUser(app, `other${Date.now()}`);
    const otherConv = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ title: 'Theirs' });

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody({ conversation_id: otherConv.body.conversation.id }));

    expect(res.status).toBe(404);
  });

  it('lists documents with pagination metadata', async () => {
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody({ title: 'a' }));
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody({ title: 'b' }));

    const all = await request(app).get('/api/documents').set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.documents.map((d: { title: string }) => d.title)).toEqual(['b', 'a']);
    expect(all.body.total).toBe(2);

    const page = await request(app)
      .get('/api/documents?limit=1&offset=1')
      .set('Authorization', `Bearer ${token}`);
    expect(page.body.documents.map((d: { title: string }) => d.title)).toEqual(['a']);
    expect(page.body.total).toBe(2);
  });

  it('filters documents by conversation', async () => {
    const conv2 = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Second' });

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody({ title: 'in first' }));
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody({ title: 'in second', conversation_id: conv2.body.conversation.id }));

    const res = await request(app)
      .get(`/api/documents?conversation_id=${conv2.body.conversation.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].title).toBe('in second');
  });

  it('validates pagination query params', async () => {
    const res = await request(app)
      .get('/api/documents?limit=9999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('gets a document with chunks and optional embeddings', async () => {
    const ingested = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody());
    const docId = ingested.body.document.id;

    const light = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(light.status).toBe(200);
    expect(light.body.chunks[0]).not.toHaveProperty('embedding');

    const full = await request(app)
      .get(`/api/documents/${docId}?include_embeddings=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(full.body.chunks[0].embedding).toEqual(EMBED_VECTOR);
  });

  it('scopes document access to the owner', async () => {
    const ingested = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody());

    const other = await registerUser(app, `snoop${Date.now()}`);
    const res = await request(app)
      .get(`/api/documents/${ingested.body.document.id}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });

  it('deletes a document and its chunks', async () => {
    const ingested = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody());
    const docId = ingested.body.document.id;

    const del = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const gone = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(gone.status).toBe(404);
  });

  it('cleans up the document when embedding fails mid-ingest', async () => {
    workerMock.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
      if (type === 'embed') {
        throw new Error('embed failure');
      }
      return 'unused';
    });

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send(ingestBody());
    expect(res.status).toBe(500);

    await waitFor(async () => {
      const rows = await pool.query('SELECT COUNT(*)::int AS n FROM documents');
      return rows.rows[0].n === 0;
    });
  });
});
