import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { registerUser, parseSSE, sseParser } from '../helpers/http.js';
import { truncateAll } from '../helpers/db.js';
import { mockDefaultWorkerBehavior, EMBED_VECTOR } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));
vi.mock('../../src/services/seedExample.js', () => ({
  seedExampleData: vi.fn().mockResolvedValue(undefined),
}));

describe('messages API (RAG streaming)', () => {
  let token: string;
  let conversationId: string;

  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);

    const auth = await registerUser(app, `msgsuser${Date.now()}`);
    token = auth.token;

    const conv = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Chat' });
    conversationId = conv.body.conversation.id;

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'knowledge',
        conversation_id: conversationId,
        chunks: [{ content: 'RAG is retrieval augmented generation.', chunk_index: 0, heading: 'What is RAG' }],
      });
  });
  afterAll(() => pool.end());

  function sendQuestion(content: string) {
    return request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content })
      .buffer(true)
      .parse(sseParser as never);
  }

  it('streams tokens then a done event, and persists both messages', async () => {
    const res = await sendQuestion('What is RAG?');

    expect(res.status).toBe(200);
    const events = parseSSE(String(res.text ?? res.body));

    const tokens = events.filter((e) => e.type === 'token').map((e) => e.content);
    const done = events.find((e) => e.type === 'done');

    expect(tokens.join('')).toBe('Mock stream answer');
    expect(done?.content).toBe('Mock stream answer');

    const msgs = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at',
      [conversationId]
    );
    expect(msgs.rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(msgs.rows[0].content).toBe('What is RAG?');
    expect(msgs.rows[1].content).toBe('Mock stream answer');
  });

  it('injects the retrieved chunk context into the chat payload', async () => {
    let chatPrompt = '';
    workerMock.rpcChatStream.mockImplementation(async (payload: { messages: [{ content: string }] }) => {
      chatPrompt = payload.messages[0].content;
      return 'done';
    });

    await sendQuestion('Explain RAG');

    expect(chatPrompt).toContain('RAG is retrieval augmented generation.');
    expect(chatPrompt).toContain('User Question: Explain RAG');
  });

  it('only retrieves context from this conversation\'s documents', async () => {
    const otherAuth = await registerUser(app, `isolated${Date.now()}`);
    const otherConv = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${otherAuth.token}`)
      .send({ title: 'Other' });
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${otherAuth.token}`)
      .send({
        title: 'other doc',
        conversation_id: otherConv.body.conversation.id,
        chunks: [{ content: 'SECRET FROM ANOTHER CHAT', chunk_index: 0 }],
      });
    workerMock.rpcChatStream.mockImplementation(
      async (payload: { messages: [{ content: string }] }) => {
        const prompt = payload.messages[0].content;
        return prompt.includes('SECRET FROM ANOTHER CHAT') ? 'LEAKED' : 'safe';
      }
    );

    const res = await sendQuestion('hello');
    const done = parseSSE(String(res.text ?? res.body)).find((e) => e.type === 'done');
    expect(done?.content).toBe('safe');
  });

  it('emits an SSE error event when the LLM call fails', async () => {
    workerMock.rpc.mockRejectedValue(new Error('LLM is down'));

    const res = await sendQuestion('hello');
    const events = parseSSE(String(res.text ?? res.body));
    const error = events.find((e) => e.type === 'error');
    expect(error?.error).toBe('Streaming failed');
  });

  it('rejects unauthenticated questions', async () => {
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: 'hello' });
    expect(res.status).toBe(401);
  });

  it('rejects questions for conversations the user does not own', async () => {
    const other = await registerUser(app, `outsider${Date.now()}`);
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ content: 'hello' });

    expect(res.status).toBe(404);
  });

  it('validates empty question bodies', async () => {
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '' });
    expect(res.status).toBe(400);
  });
});
