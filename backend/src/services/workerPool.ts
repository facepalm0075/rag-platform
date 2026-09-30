import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../logging/index.js';

interface PendingTask {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface StreamTask {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

export class WorkerPool {
  private wss: WebSocketServer | null = null;
  private workers: WebSocket[] = [];
  private pendingTasks = new Map<string, PendingTask>();
  private streamingTasks = new Map<string, StreamTask>();
  private nextWorkerIndex = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private pendingPongs = new Map<WebSocket, NodeJS.Timeout>();
  onWorkerConnected: (() => void) | null = null;

  initialize(server: import('http').Server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const authHeader = req.headers['x-worker-auth'];
      if (authHeader !== config.WORKER_AUTH_SECRET) {
        log('warn', 'Rejected worker connection: bad auth secret', {}, 'worker');
        ws.close(4001, 'Unauthorized');
        return;
      }

      log('info', 'AI Worker connected', {}, 'worker');
      this.workers.push(ws);
      this.onWorkerConnected?.();

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          const streamTask = this.streamingTasks.get(response.id);
          if (streamTask) {
            if (response.error) {
              clearTimeout(streamTask.timeout);
              this.streamingTasks.delete(response.id);
              streamTask.onError(new Error(response.error));
            } else if (response.done) {
              clearTimeout(streamTask.timeout);
              this.streamingTasks.delete(response.id);
              streamTask.onDone();
            } else if (response.content !== undefined) {
              streamTask.onToken(response.content);
            }
            return;
          }

          const pending = this.pendingTasks.get(response.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingTasks.delete(response.id);
            if (response.success) {
              pending.resolve(response.data);
            } else {
              pending.reject(new Error(response.error || 'Worker task failed'));
            }
          }
        } catch {
          log('warn', 'Invalid message from worker', {}, 'worker');
        }
      });

      ws.on('pong', () => {
        this.clearPongTimeout(ws);
      });

      ws.on('close', () => {
        log('info', 'AI Worker disconnected', {}, 'worker');
        this.workers = this.workers.filter((w) => w !== ws);
        this.clearPongTimeout(ws);
      });

      ws.on('error', (err) => {
        log('error', 'Worker WebSocket error', { message: err.message }, 'worker');
        this.workers = this.workers.filter((w) => w !== ws);
        this.clearPongTimeout(ws);
      });
    });

    this.startPingInterval();
  }

  private clearPongTimeout(ws: WebSocket){
    const pongTimeout = this.pendingPongs.get(ws);
    if (pongTimeout) {
      clearTimeout(pongTimeout);
      this.pendingPongs.delete(ws);
    }
  }

  private hasConnectedWorker(): boolean {
    return true;
    return this.workers.some((w) => w.readyState === WebSocket.OPEN);
  }

  async rpc(type: 'embed' | 'chat', payload: Record<string, unknown>): Promise<unknown> {
    if (this.hasConnectedWorker()) {
      return this.sendToWorker(type, payload);
    }
    return this.fallback(type, payload);
  }

  async rpcChatStream(
    payload: Record<string, unknown>,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.hasConnectedWorker()) {
      return this.sendToWorkerStream(payload, onToken, signal);
    }
    return this.fallbackChatStream(payload, onToken, signal);
  }

  private pickWorker(): WebSocket {
    const open = this.workers.filter((w) => w.readyState === WebSocket.OPEN);
    if (open.length === 0) throw new Error('No connected worker');
    const worker = open[this.nextWorkerIndex % open.length];
    this.nextWorkerIndex++;
    return worker;
  }

  private startPingInterval() {
    this.pingInterval = setInterval(() => {
      for (const ws of this.workers) {
        if (ws.readyState === WebSocket.OPEN) {
          this.clearPongTimeout(ws);
          ws.ping();
          const timeout = setTimeout(() => {
            log('warn', 'Worker did not respond to ping, terminating', {}, 'worker');
            this.removeWorker(ws);
          }, 10000);
          this.pendingPongs.set(ws, timeout);
        }
      }
    }, 30000);
  }

  private removeWorker(ws: WebSocket) {
    this.clearPongTimeout(ws);
    ws.close(4002, 'Ping timeout');
  }

  private sendToWorker(type: 'embed' | 'chat', payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const worker = this.pickWorker();

      const timeout = setTimeout(() => {
        this.pendingTasks.delete(id);
        reject(new Error('Worker task timed out'));
      }, 30000);

      this.pendingTasks.set(id, { resolve, reject, timeout });
      worker.send(JSON.stringify({ id, type, payload }));
    });
  }

  private sendToWorkerStream(
    payload: Record<string, unknown>,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      let worker: WebSocket;
      try {
        worker = this.pickWorker();
      } catch (err) {
        reject(err);
        return;
      }

      let settled = false;
      let fullContent = '';
      let timeout: NodeJS.Timeout;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.streamingTasks.delete(id);
        worker.send(JSON.stringify({ id: uuidv4(), type: 'abort', payload: { taskId: id } }));
        reject(new Error('Aborted'));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        this.streamingTasks.delete(id);
        reject(new Error('Worker stream timed out'));
      }, 60000);

      this.streamingTasks.set(id, {
        onToken: (token: string) => {
          if (settled) return;
          fullContent += token;
          onToken(token);
        },
        onDone: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onAbort);
          resolve(fullContent);
        },
        onError: (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
        timeout,
      });

      worker.send(JSON.stringify({ id, type: 'chat', payload: { ...payload, stream: true } }));
    });
  }

  private async fallback(type: 'embed' | 'chat', payload: Record<string, unknown>): Promise<unknown> {
    if (config.FALLBACK_API_KEYS.length === 0) {
      throw new Error('No workers connected and no fallback API keys configured');
    }

    const apiKey = config.FALLBACK_API_KEYS[0];

    if (type === 'embed') {
      return this.fallbackEmbed(payload, apiKey);
    }
    return this.fallbackChat(payload, apiKey);
  }

  private async fallbackEmbed(payload: Record<string, unknown>, apiKey: string): Promise<unknown> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: payload.input,
        model: config.FALLBACK_EMBEDDING_MODEL,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.map((d: { embedding: number[] }) => d.embedding);
  }

  private async fallbackChat(payload: Record<string, unknown>, apiKey: string): Promise<unknown> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.FALLBACK_LLM_MODEL,
        messages: payload.messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  private async fallbackChatStream(
    payload: Record<string, unknown>,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const apiKey = config.FALLBACK_API_KEYS[0];
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.FALLBACK_LLM_MODEL,
          messages: payload.messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat API error: ${response.statusText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return fullContent;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onToken(content);
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      }

      return fullContent;
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new Error('Aborted');
      }
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  shutdown() {
    log('info', 'Shutting down worker pool...', {}, 'worker');

    // Stop accepting new worker connections.
    this.wss?.close();

    // Close all existing worker WebSockets.
    for (const ws of this.workers) {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(1001, 'Server shutting down');
      }
    }

    this.workers = [];

    for (const [, pending] of this.pendingTasks) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Server shutting down'));
    }

    this.pendingTasks.clear();

    for (const [, stream] of this.streamingTasks) {
      clearTimeout(stream.timeout);
      stream.onError(new Error('Server shutting down'));
    }

    this.streamingTasks.clear();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const [, timeout] of this.pendingPongs) {
      clearTimeout(timeout);
    }

    this.pendingPongs.clear();
  }
}

export const workerPool = new WorkerPool();
