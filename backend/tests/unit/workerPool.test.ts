import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { WorkerPool } from '../../src/services/workerPool.js';

const AUTH_SECRET = 'dev-secret';

async function startPool(): Promise<{ pool: WorkerPool; server: Server; port: number }> {
  const pool = new WorkerPool();
  const server = createServer();
  pool.initialize(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return { pool, server, port };
}

function connectWorker(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { 'x-worker-auth': AUTH_SECRET },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('WorkerPool', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('round-robins tasks across connected workers', async () => {
    const { pool, server, port } = await startPool();
    const receivedA: { type: string; id: string }[] = [];
    const receivedB: { type: string; id: string }[] = [];

    const wsA = await connectWorker(port);
    const wsB = await connectWorker(port);

    wsA.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      receivedA.push({ type: msg.type, id: msg.id });
      wsA.send(JSON.stringify({ id: msg.id, success: true, data: 'from-A' }));
    });
    wsB.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      receivedB.push({ type: msg.type, id: msg.id });
      wsB.send(JSON.stringify({ id: msg.id, success: true, data: 'from-B' }));
    });

    const first = await pool.rpc('embed', { input: ['a'] });
    const second = await pool.rpc('embed', { input: ['b'] });
    const third = await pool.rpc('chat', { messages: [{ role: 'user', content: 'hi' }] });

    expect(first).toBe('from-A');
    expect(second).toBe('from-B');
    expect(third).toBe('from-A');
    expect(receivedA.length).toBe(2);
    expect(receivedB.length).toBe(1);
    expect(receivedA[0].type).toBe('embed');
    expect(receivedA[1].type).toBe('chat');

    wsA.close();
    wsB.close();
    server.close();
    pool.shutdown();
  });

  it('rejects with a timeout when the worker never responds', async () => {
    vi.useFakeTimers();
    const { pool, server, port } = await startPool();
    const ws = await connectWorker(port);
    ws.on('message', () => {
      // never respond
    });

    const task = pool.rpc('embed', { input: ['x'] });
    const assertion = expect(task).rejects.toThrow('Worker task timed out');
    vi.advanceTimersByTime(31_000);
    await assertion;

    vi.useRealTimers();
    ws.close();
    server.close();
    pool.shutdown();
  });

  it('rejects when no workers are connected and no fallback keys are configured', async () => {
    vi.resetModules();
    delete process.env.FALLBACK_API_KEYS;
    const { WorkerPool: WP } = await import('../../src/services/workerPool.js');
    const pool = new WP();
    await expect(pool.rpc('embed', { input: ['x'] })).rejects.toThrow(
      'No workers connected and no fallback API keys configured'
    );
  });

  it('falls back to the OpenAI-compatible chat API when no worker is connected', async () => {
    vi.resetModules();
    process.env.FALLBACK_API_KEYS = 'sk-test';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content: 'fallback answer' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { WorkerPool: WP } = await import('../../src/services/workerPool.js');
    const pool = new WP();
    const result = await pool.rpc('chat', {
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toBe('fallback answer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('gpt-4o-mini');
  });

  it('parses an SSE stream from the fallback chat API into tokens', async () => {
    vi.resetModules();
    process.env.FALLBACK_API_KEYS = 'sk-test';

    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      body: {
        getReader: () => {
          let i = 0;
          return {
            read: async () =>
              i < chunks.length
                ? { done: false, value: Buffer.from(chunks[i++]) }
                : { done: true, value: undefined },
            cancel: async () => {},
          };
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const { WorkerPool: WP } = await import('../../src/services/workerPool.js');
    const pool = new WP();

    const tokens: string[] = [];
    const result = await pool.rpcChatStream(
      { messages: [{ role: 'user', content: 'hi' }] },
      (token) => tokens.push(token)
    );

    expect(tokens).toEqual(['Hel', 'lo ', 'world']);
    expect(result).toBe('Hello world');
  });

  it('surfaces errors from the fallback chat API', async () => {
    vi.resetModules();
    process.env.FALLBACK_API_KEYS = 'sk-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, statusText: 'Unauthorized' })
    );

    const { WorkerPool: WP } = await import('../../src/services/workerPool.js');
    const pool = new WP();
    await expect(pool.rpc('chat', { messages: [] })).rejects.toThrow(
      'Chat API error: Unauthorized'
    );
  });

  it('rejects pending tasks on shutdown', async () => {
    const { pool, server, port } = await startPool();
    const ws = await connectWorker(port);
    ws.on('message', () => {
      // never respond
    });

    const task = pool.rpc('embed', { input: ['x'] });
    pool.shutdown();
    await expect(task).rejects.toThrow('Server shutting down');

    ws.close();
    server.close();
  });
});
