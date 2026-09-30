import request from 'supertest';
import { Express } from 'express';

export interface AuthResult {
  user: { id: string; username: string };
  token: string;
}

export async function registerUser(app: Express, username: string): Promise<AuthResult> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return res.body as AuthResult;
}

export interface SSEEvent {
  type: string;
  content?: string;
  error?: string;
}

export function parseSSE(raw: string): SSEEvent[] {
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as SSEEvent);
}

export function sseParser(
  res: NodeJS.ReadableStream & { setEncoding(enc: string): void },
  callback: (err: Error | null, body?: string) => void
): void {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    data += chunk;
  });
  res.on('end', () => callback(null, data));
}
