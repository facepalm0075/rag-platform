CREATE TABLE IF NOT EXISTS example_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension INTEGER NOT NULL,
  source VARCHAR(50),
  model TEXT,
  embeddings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
