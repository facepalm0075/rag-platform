import { describe, it, expect, beforeEach, vi } from 'vitest';

const ENV_KEYS = [
  'PORT',
  'DATABASE_URL',
  'WORKER_AUTH_SECRET',
  'FALLBACK_API_KEYS',
  'FALLBACK_LLM_MODEL',
  'FALLBACK_EMBEDDING_MODEL',
  'TOP_K_CHUNKS',
  'CORS_ORIGIN',
  'VECTOR_DIMENSION',
  'SESSION_EXPIRY_DAYS',
];

describe('config', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    vi.resetModules();
  });

  it('applies defaults when env vars are not set', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe('postgresql://localhost:5432/rag');
    expect(config.WORKER_AUTH_SECRET).toBe('dev-secret');
    expect(config.FALLBACK_API_KEYS).toEqual([]);
    expect(config.FALLBACK_LLM_MODEL).toBe('gpt-4o-mini');
    expect(config.FALLBACK_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(config.TOP_K_CHUNKS).toBe(5);
    expect(config.CORS_ORIGIN).toBe('http://localhost:5173');
    expect(config.VECTOR_DIMENSION).toBe(768);
    expect(config.SESSION_EXPIRY_DAYS).toBe(30);
  });

  it('coerces numeric env vars', async () => {
    process.env.PORT = '8080';
    process.env.TOP_K_CHUNKS = '3';
    process.env.VECTOR_DIMENSION = '1024';
    const { config } = await import('../../src/config/index.js');
    expect(config.PORT).toBe(8080);
    expect(config.TOP_K_CHUNKS).toBe(3);
    expect(config.VECTOR_DIMENSION).toBe(1024);
  });

  it('parses FALLBACK_API_KEYS into a trimmed, de-duplicated list', async () => {
    process.env.FALLBACK_API_KEYS = 'sk-a, sk-b ,, sk-c';
    const { config } = await import('../../src/config/index.js');
    expect(config.FALLBACK_API_KEYS).toEqual(['sk-a', 'sk-b', 'sk-c']);
  });

  it('exits the process when the environment is invalid', async () => {
    process.env.PORT = 'not-a-number';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as unknown as (code?: number) => never);

    await expect(import('../../src/config/index.js')).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
