import { pool } from '../db/pool.js';
import { ExampleEmbedding } from '../types/index.js';

export async function findExampleEmbedding(): Promise<ExampleEmbedding | undefined> {
  const result = await pool.query<ExampleEmbedding>(
    'SELECT * FROM example_embeddings ORDER BY created_at DESC LIMIT 1'
  );
  return result.rows[0];
}

export async function createExampleEmbedding(data: {
  dimension: number;
  source: string;
  model: string;
  embeddings: number[][];
}): Promise<ExampleEmbedding> {
  const result = await pool.query<ExampleEmbedding>(
    'INSERT INTO example_embeddings (dimension, source, model, embeddings) VALUES ($1, $2, $3, $4) RETURNING *',
    [data.dimension, data.source, data.model, JSON.stringify(data.embeddings)]
  );
  return result.rows[0];
}
