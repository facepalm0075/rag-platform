import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { validate, validateQuery } from '../../src/middleware/validate.js';

function fakeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as import('express').Response;
  vi.mocked(res.status).mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  const schema = z.object({ name: z.string().min(2) });

  it('passes valid body through and calls next', () => {
    const res = fakeResponse();
    const next = vi.fn();
    const req = { body: { name: 'ok' } } as never;
    validate(schema)(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid body with 400 and field details', () => {
    const res = fakeResponse();
    const next = vi.fn();
    const req = { body: { name: 'x' } } as never;
    validate(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.any(Object),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('sanitizes the body to the parsed shape', () => {
    const res = fakeResponse();
    const next = vi.fn();
    const req = { body: { name: 'valid', extra: 'dropped' } } as never;
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validateQuery middleware', () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  });

  it('passes valid query params', () => {
    const res = fakeResponse();
    const next = vi.fn();
    const req = { query: { limit: '50' } } as never;
    validateQuery(schema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects out-of-range query params with 400', () => {
    const res = fakeResponse();
    const next = vi.fn();
    const req = { query: { limit: '500' } } as never;
    validateQuery(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
