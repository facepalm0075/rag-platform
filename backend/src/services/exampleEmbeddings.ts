import { config } from '../config/index.js';
import { findExampleEmbedding, createExampleEmbedding } from '../repositories/exampleEmbedding.js';
import { workerPool } from './workerPool.js';
import { EXAMPLE_CHUNKS } from '../seed/exampleData.js';

export async function ensureExampleEmbeddings(): Promise<void> {
  try {
    const existing = await findExampleEmbedding();
    if (existing) return;

    const texts = EXAMPLE_CHUNKS.map((c) => c.content);
    const embeddings = (await workerPool.rpc('embed', { input: texts })) as number[][];

    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      console.warn('Example embedding response does not match chunk count; skipping generation.');
      return;
    }

    await createExampleEmbedding({
      dimension: config.VECTOR_DIMENSION,
      source: 'worker-or-fallback',
      model: 'unknown',
      embeddings,
    });
    console.log('Generated and stored example embeddings in the database.');
  } catch (err) {
    console.warn('Example embeddings not generated yet (no worker connected?):', (err as Error).message);
  }
}
