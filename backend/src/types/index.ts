export interface User {
  id: string;
  username: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  created_at: Date;
  expires_at: Date;
}

export interface Document {
  id: string;
  user_id: string;
  conversation_id: string;
  title: string;
  source_type: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface Chunk {
  id: string;
  document_id: string;
  content: string;
  embedding?: number[];
  chunk_index: number;
  heading?: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
}

export interface ExampleEmbedding {
  id: string;
  dimension: number;
  source: string | null;
  model: string | null;
  embeddings: number[][];
  created_at: Date;
}

export interface ChunkInput {
  content: string;
  chunk_index: number;
  heading?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestDocumentInput {
  title: string;
  source_type?: string;
  metadata?: Record<string, unknown>;
  chunks: ChunkInput[];
}

export interface AuthPayload {
  user: Omit<User, 'password_hash'>;
  token: string;
}

export interface HistoryScope {
  from?: number;
  to?: number;
}

export interface WorkerTask {
  id: string;
  type: 'embed' | 'chat' | 'abort';
  payload: Record<string, unknown>;
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SearchResult {
  chunk: Chunk;
  distance: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SystemLog {
  id: number;
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  user_id: string | null;
  username: string | null;
  meta: Record<string, unknown>;
}

export interface SystemLogFilters {
  level?: LogLevel;
  category?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}
