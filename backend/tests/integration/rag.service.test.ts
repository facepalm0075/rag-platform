import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { answerQuestion, answerQuestionStream } from '../../src/services/rag.js';
import { createUser } from '../../src/repositories/user.js';
import { createConversation } from '../../src/repositories/conversation.js';
import { createDocument } from '../../src/repositories/document.js';
import { createChunks } from '../../src/repositories/chunk.js';
import { findMessagesByConversationId } from '../../src/repositories/message.js';
import { truncateAll, makeVector } from '../helpers/db.js';
import { mockDefaultWorkerBehavior } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));

const QUERY_VECTOR = makeVector(1);

describe('rag service', () => {
  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);
  });
  afterAll(() => pool.end());

  async function seedContext(userId: string, convId: string, content: string) {
    const doc = await createDocument(userId, convId, 'Doc', null, {});
    await createChunks(doc.id, [{ content, chunk_index: 0 }], [QUERY_VECTOR]);
  }

  it('answers a question using context from the conversation documents', async () => {
    workerMock.rpc.mockImplementation(async (type: string) => {
      if (type === 'embed') return [QUERY_VECTOR];
      return 'grounded answer';
    });

    const user = await createUser('alice', 'hash');
    const conv = await createConversation(user.id, 'chat');
    await seedContext(user.id, conv.id, 'The capital of France is Paris.');

    const { userMessage, assistantMessage } = await answerQuestion(
      user.id,
      conv.id,
      'What is the capital of France?'
    );

    expect(userMessage.role).toBe('user');
    expect(userMessage.content).toBe('What is the capital of France?');
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.content).toBe('grounded answer');

    const chatPayload = workerMock.rpc.mock.calls.find((c) => c[0] === 'chat')?.[1] as {
      messages: [{ content: string }];
    };
    const prompt = chatPayload.messages[0].content;
    expect(prompt).toContain('The capital of France is Paris.');
    expect(prompt).toContain('User Question: What is the capital of France?');
    expect(prompt).toContain('Conversation History:');
  });

  it('persists both messages for the conversation', async () => {
    workerMock.rpc.mockImplementation(async (type: string) => {
      if (type === 'embed') return [QUERY_VECTOR];
      return 'answer';
    });
    const user = await createUser('bob', 'hash');
    const conv = await createConversation(user.id, 'chat');

    await answerQuestion(user.id, conv.id, 'hello');

    const messages = await findMessagesByConversationId(conv.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('never leaks chunks from other conversations into the prompt', async () => {
    let prompt = '';
    workerMock.rpc.mockImplementation(async (type: string, payload: unknown) => {
      if (type === 'embed') return [QUERY_VECTOR];
      prompt = (payload as { messages: [{ content: string }] }).messages[0].content;
      return 'answer';
    });

    const user = await createUser('carol', 'hash');
    const convA = await createConversation(user.id, 'A');
    const convB = await createConversation(user.id, 'B');
    await seedContext(user.id, convB.id, 'SECRET FROM CONVERSATION B');

    await answerQuestion(user.id, convA.id, 'any question');
    expect(prompt).not.toContain('SECRET FROM CONVERSATION B');
  });

  it('rejects when the conversation belongs to another user', async () => {
    const owner = await createUser('dave', 'hash');
    const intruder = await createUser('erin', 'hash');
    const conv = await createConversation(owner.id, 'private');

    await expect(answerQuestion(intruder.id, conv.id, 'hi')).rejects.toThrow(
      'Conversation not found'
    );
    expect(await findMessagesByConversationId(conv.id)).toEqual([]);
  });

  it('includes the last 10 messages as history', async () => {
    workerMock.rpc.mockImplementation(async (type: string, payload: unknown) => {
      if (type === 'embed') return [QUERY_VECTOR];
      const prompt = (payload as { messages: [{ content: string }] }).messages[0].content;
      return prompt.includes('m13') ? 'has-history' : 'missing-history';
    });

    const user = await createUser('frank', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const { createMessage } = await import('../../src/repositories/message.js');
    for (let i = 0; i < 15; i++) await createMessage(conv.id, 'user', `m${i}`);

    const { assistantMessage } = await answerQuestion(user.id, conv.id, 'which is the newest?');
    expect(assistantMessage.content).toBe('has-history');
  });

  it('streams tokens and persists the full answer', async () => {
    workerMock.rpc.mockImplementation(async (type: string) => {
      if (type === 'embed') return [QUERY_VECTOR];
      return 'unused';
    });
    workerMock.rpcChatStream.mockImplementation(
      async (_payload: unknown, onToken: (t: string) => void) => {
        for (const t of ['Hello', ' world']) onToken(t);
        return 'Hello world';
      }
    );

    const user = await createUser('grace', 'hash');
    const conv = await createConversation(user.id, 'chat');

    const tokens: string[] = [];
    const { userMessage, fullContent } = await answerQuestionStream(
      user.id,
      conv.id,
      'greet me',
      (t) => tokens.push(t)
    );

    expect(tokens).toEqual(['Hello', ' world']);
    expect(fullContent).toBe('Hello world');
    expect(userMessage.role).toBe('user');

    const messages = await findMessagesByConversationId(conv.id);
    expect(messages[messages.length - 1].content).toBe('Hello world');
  });

  it('supports aborting a stream', async () => {
    workerMock.rpc.mockImplementation(async (type: string) => {
      if (type === 'embed') return [QUERY_VECTOR];
      return 'unused';
    });
    workerMock.rpcChatStream.mockRejectedValue(new Error('Aborted'));

    const user = await createUser('heidi', 'hash');
    const conv = await createConversation(user.id, 'chat');
    const controller = new AbortController();
    controller.abort();

    await expect(
      answerQuestionStream(user.id, conv.id, 'hi', () => {}, controller.signal)
    ).rejects.toThrow('Aborted');
  });

  it('persists the partial answer when a stream fails mid-generation', async () => {
    workerMock.rpc.mockImplementation(async (type: string) => {
      if (type === 'embed') return [QUERY_VECTOR];
      return 'unused';
    });
    workerMock.rpcChatStream.mockImplementation(
      async (_payload: unknown, onToken: (t: string) => void) => {
        onToken('Partial ');
        onToken('answer');
        throw new Error('Worker crashed');
      }
    );

    const user = await createUser('ivan', 'hash');
    const conv = await createConversation(user.id, 'chat');

    await expect(
      answerQuestionStream(user.id, conv.id, 'hi', () => {})
    ).rejects.toThrow('Worker crashed');

    const messages = await findMessagesByConversationId(conv.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toBe('Partial answer');
  });

  it('persists nothing when the stream fails before any token arrives', async () => {
    workerMock.rpc.mockImplementation(async (type: string) => {
      if (type === 'embed') return [QUERY_VECTOR];
      return 'unused';
    });
    workerMock.rpcChatStream.mockRejectedValue(new Error('Worker crashed'));

    const user = await createUser('judy', 'hash');
    const conv = await createConversation(user.id, 'chat');

    await expect(
      answerQuestionStream(user.id, conv.id, 'hi', () => {})
    ).rejects.toThrow('Worker crashed');

    const messages = await findMessagesByConversationId(conv.id);
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });
});
