import dotenv from 'dotenv';
dotenv.config();

export const config = {
  SERVER_URL: process.env.SERVER_URL || 'ws://localhost:8080',
  WORKER_AUTH_SECRET: process.env.WORKER_AUTH_SECRET || '',
  LMSTUDIO_BASE_URL: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
  LMSTUDIO_CONFIG_BASE_URL: process.env.LMSTUDIO_CONFIG_BASE_URL || 'http://localhost:1234/api/v1',
  LMSTUDIO_API_KEY: process.env.LMSTUDIO_API_KEY || 'lm-studio',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'local-embedding-model',
  LLM_MODEL: process.env.LLM_MODEL || 'local-llm-model',
  LMSTUDIO_LLM_LOAD_OPTIONS: process.env.LMSTUDIO_LLM_LOAD_OPTIONS || '',
  LMSTUDIO_EMBEDDING_LOAD_OPTIONS: process.env.LMSTUDIO_EMBEDDING_LOAD_OPTIONS || '',
  LMSTUDIO_RETRY_INTERVAL: parseInt(process.env.LMSTUDIO_RETRY_INTERVAL || '5000', 10),
  LMSTUDIO_MAX_RETRIES: parseInt(process.env.LMSTUDIO_MAX_RETRIES || '60', 10),
};