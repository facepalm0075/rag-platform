import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/rag'),
  WORKER_AUTH_SECRET: z.string().default('dev-secret'),
  FALLBACK_API_KEYS: z.string().default(''),
  FALLBACK_LLM_MODEL: z.string().default('gpt-4o-mini'),
  FALLBACK_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  TOP_K_CHUNKS: z.coerce.number().default(5),
  CONCURRENT_CHATS: z.coerce.number().default(3),
  CHAT_QUEUE_LENGTH: z.coerce.number().default(10),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  VECTOR_DIMENSION: z.coerce.number().default(768),
  SESSION_EXPIRY_DAYS: z.coerce.number().default(30),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('changeme'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  FALLBACK_API_KEYS: parsed.data.FALLBACK_API_KEYS
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
};
