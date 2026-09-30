import { describe, it, expect } from 'vitest';
import { buildEmbedBatches } from '../../src/services/documents.js';

describe('buildEmbedBatches', () => {
  it('returns an empty list for no texts', () => {
    expect(buildEmbedBatches([])).toEqual([]);
  });

  it('keeps a single small batch together', () => {
    const texts = ['a', 'b', 'c'];
    expect(buildEmbedBatches(texts)).toEqual([['a', 'b', 'c']]);
  });

  it('splits by count limit (50 texts per batch)', () => {
    const texts = Array.from({ length: 101 }, (_, i) => `text-${i}`);
    const batches = buildEmbedBatches(texts);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(50);
    expect(batches[1].length).toBe(50);
    expect(batches[2].length).toBe(1);
  });

  it('splits by character limit (8000 chars per batch), packing small texts after big ones', () => {
    const longText = 'x'.repeat(5000);
    const batches = buildEmbedBatches([longText, longText, 'short']);
    expect(batches).toEqual([[longText], [longText, 'short']]);

    const threeLong = buildEmbedBatches([longText, longText, longText]);
    expect(threeLong).toEqual([[longText], [longText], [longText]]);
  });

  it('starts a new batch when the next text would exceed the char limit', () => {
    const a = 'a'.repeat(6000);
    const b = 'b'.repeat(6000);
    const c = 'c'.repeat(6000);
    expect(buildEmbedBatches([a, b, c])).toEqual([[a], [b], [c]]);

    const packable = buildEmbedBatches([a, b, 'small', c]);
    expect(packable).toEqual([[a], [b, 'small'], [c]]);
  });

  it('preserves order across batches', () => {
    const texts = Array.from({ length: 55 }, (_, i) => `t${i}`);
    const batches = buildEmbedBatches(texts);
    const flattened = batches.flat();
    expect(flattened).toEqual(texts);
  });
});
