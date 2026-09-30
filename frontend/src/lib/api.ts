// ============================================================================
// REAL API CLIENT — talks to the RAG backend.
// Base URL lives in src/config/app.config.json under `api.baseUrl`
// (override it for production, e.g. https://api.example.com).
// The exported types and function signatures are the contract the UI uses;
// server responses are mapped to the frontend's Session/Chunk/Message model.
// ============================================================================

import type { Chunk } from "./chunker";
import { app, api as apiConfig, chat } from "@/config";

export type { Chunk };

// ---------- Frontend domain types ----------

export type User = { id: string; username: string; created_at: string };
export type SourceType = "file" | "manual" | "seed";
export type Session = {
  id: string;
  conversationId: string;
  name: string;
  sourceType: SourceType;
  sourceMeta: string;
  chunkCount?: number;
  createdAt: string;
};

/**
 * Response modes:
 *  - "user"      → the visitor
 *  - "assistant" → a grounded model answer
 *  - "system"    → local pipeline notice (stream aborted, client-side errors).
 *                  The backend only ever produces "user"/"assistant".
 */
export type MessageRole = "user" | "assistant" | "system";
export type SystemLevel = "info" | "warning" | "error";
export type Message = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  level?: SystemLevel;
  createdAt: string;
};

// ---------- Raw backend shapes ----------

type ApiUser = {
  id: string;
  username: string;
  created_at: string;
  updated_at: string;
};

type ApiDocument = {
  id: string;
  user_id: string;
  conversation_id: string;
  title: string;
  source_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ApiConversation = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ApiMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ApiChunkRow = {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  heading: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  document_title?: string;
};

// ---------- Transport ----------

const BASE_URL = apiConfig.baseUrl.replace(/\/+$/, "");

const K_TOKEN = `${app.storagePrefix}.token`;

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(K_TOKEN);
}

function storeToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(K_TOKEN, token);
}

function clearToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(K_TOKEN);
}

async function errorFrom(res: Response): Promise<Error> {
  const stat = res.status;
  const codes = [400, 401, 404];
  const errOpt: { cause: Record<string, unknown> } = { cause: { status: stat } };

  if (codes.includes(stat)) {
    errOpt.cause = { type: "client", status: stat, dontStore: true };
  }
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return new Error(body.error, errOpt);
    if (typeof body?.message === "string") return new Error(body.message, errOpt);
  } catch {
    // non-JSON body, fall through
  }
  return new Error(`Request failed (${res.status})`);
}

/** Authenticated JSON request with the Bearer token attached automatically. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

// ---------- Mapping helpers ----------

function toUser(u: ApiUser): User {
  return { id: u.id, username: u.username, created_at: u.created_at };
}

function toSession(doc: ApiDocument, chunkCount?: number): Session {
  const n = chunkCount ?? 0;
  let sourceMeta: string;
  if (doc.source_type === "file") {
    sourceMeta =
      typeof doc.metadata?.filename === "string" ? (doc.metadata.filename as string) : "File";
  } else if (doc.source_type === "manual") {
    const stored =
      typeof doc.metadata?.entryCount === "number" ? (doc.metadata.entryCount as number) : n;
    sourceMeta = `${stored} entr${stored === 1 ? "y" : "ies"}`;
  } else {
    sourceMeta = "Seed document";
  }
  return {
    id: doc.id,
    conversationId: doc.conversation_id,
    name: doc.title,
    sourceType: (doc.source_type ?? "manual") as SourceType,
    sourceMeta,
    chunkCount: chunkCount,
    createdAt: doc.created_at,
  };
}

function toMessage(m: ApiMessage): Message {
  return {
    id: m.id,
    sessionId: m.conversation_id,
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
  };
}

// ---------- Auth ----------

export async function signIn(username: string, password: string): Promise<User> {
  const data = await request<{ user: ApiUser; token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  storeToken(data.token);
  return toUser(data.user);
}

export async function signUp(username: string, password: string): Promise<User> {
  const data = await request<{ user: ApiUser; token: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  storeToken(data.token);
  return toUser(data.user);
}

export async function signOut(): Promise<void> {
  try {
    await request<{ success: boolean }>("/api/auth/logout", { method: "POST" });
  } catch {
    // best effort — the local token is cleared either way
  }
  clearToken();
}

export async function getCurrentUser(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    const data = await request<{ user: ApiUser }>("/api/auth/me");
    return toUser(data.user);
  } catch (error) {
    const status = (error as Error).cause as { status?: number } | undefined;
    // Only a 401 proves the token is invalid/expired — drop it then.
    // Network or server errors keep the token so a valid session isn't
    // destroyed by a transient outage at startup.
    if (status?.status === 401) clearToken();
    return null;
  }
}

// ---------- Sessions (documents + their conversation) ----------

export async function listSessions(): Promise<Session[]> {
  const data = await request<{ documents: ApiDocument[]; total: number }>(
    "/api/documents?limit=200",
  );
  return data.documents.map((d) => toSession(d));
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    const data = await request<{ document: ApiDocument; chunks: ApiChunkRow[] }>(
      `/api/documents/${id}`,
    );
    return toSession(data.document, data.chunks.length);
  } catch {
    return null;
  }
}

async function createConversationForSession(title: string): Promise<string> {
  const data = await request<{ conversation: ApiConversation }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return data.conversation.id;
}

/**
 * The file is parsed and chunked in the browser; only the ordered chunk array
 * reaches this call. A conversation is created first, then the document is
 * ingested into it with the filename kept in metadata.
 */
export async function createSessionFromFile(
  name: string,
  sourceMeta: string,
  chunks: Chunk[],
): Promise<Session> {
  const conversationId = await createConversationForSession(name);
  const data = await request<{ document: ApiDocument; chunks: ApiChunkRow[] }>("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      title: name,
      conversation_id: conversationId,
      source_type: "file",
      metadata: { filename: sourceMeta },
      chunks: chunks.map((c, i) => ({
        content: c.content,
        chunk_index: i,
        heading: c.header || undefined,
      })),
    }),
  });
  return toSession(data.document, data.chunks.length);
}

export async function createSessionFromManual(name: string, chunks: Chunk[]): Promise<Session> {
  const conversationId = await createConversationForSession(name);
  const data = await request<{ document: ApiDocument; chunks: ApiChunkRow[] }>("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      title: name,
      conversation_id: conversationId,
      source_type: "manual",
      metadata: { entryCount: chunks.length },
      chunks: chunks.map((c, i) => ({
        content: c.content,
        chunk_index: i,
        heading: c.header || undefined,
      })),
    }),
  });
  return toSession(data.document, data.chunks.length);
}

/** Every chunk of the session's conversation, in ingest order. */
export async function listChunks(session: Session): Promise<Chunk[]> {
  const data = await request<{
    conversation: ApiConversation;
    chunks: ApiChunkRow[];
    total: number;
  }>(`/api/conversations/${session.conversationId}/chunks?limit=200`);
  return data.chunks.map((c) => ({ header: c.heading ?? "", content: c.content }));
}

/** Deleting a session deletes its conversation, cascading to documents + chunks. */
export async function deleteSession(session: Session): Promise<void> {
  await request<{ success: boolean }>(`/api/conversations/${session.conversationId}`, {
    method: "DELETE",
  });
}

// ---------- Chat ----------

export type MessagePage = {
  messages: Message[];
  /** Pass as `offset` to load the previous (older) page. */
  nextOffset: number | null;
  hasMore: boolean;
};

/**
 * Newest-last page of a conversation via 1-based inclusive from/to paging.
 * GET /api/conversations/:id?from=&to= — the server also returns `total`.
 */
export async function listMessages(
  conversationId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<MessagePage> {
  const limit = opts.limit ?? chat.pageSize;
  const offset = opts.offset ?? 0;
  const data = await request<{
    conversation: ApiConversation;
    messages: ApiMessage[];
    total: number;
  }>(`/api/conversations/${conversationId}?from=${offset + 1}&to=${offset + limit}`);

  const messages = data.messages.map(toMessage);
  const nextOffset = offset + messages.length;
  return { messages, nextOffset, hasMore: nextOffset < data.total };
}

/** Streamed part of a reply. The backend only emits assistant text. */
export type StreamPart = {
  role: "assistant" | "system";
  level?: SystemLevel;
  content: string;
};

/**
 * Streams a grounded RAG answer from the backend SSE endpoint
 * (POST /api/conversations/:id/messages). Yields the accumulated text as
 * tokens arrive; throws if the server signals an error. Aborting the
 * signal closes the connection, which makes the backend abort the worker.
 */
export async function* sendMessage(
  conversationId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamPart, Message, void> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content }),
      signal,
    });
  } catch (error) {
    // Handle fetch-specific errors
    if (error instanceof Error) {
      // Check if it's an AbortError (signal abortion)
      if (error.name === "AbortError") {
        throw new Error("Stream Canceled", {
          cause: { type: "client", reason: "aborted" },
        });
      }

      // Check if it's a network/connection error
      if (
        error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.message.includes("connect")
      ) {
        throw new Error("Network/Server connection error", {
          cause: { type: "client", reason: "network_error", original: error, dontStore: true },
        });
      }

      // Check for timeout or other client errors
      if (error.message.includes("timeout")) {
        throw new Error("Request timeout", {
          cause: { type: "client", reason: "timeout", dontStore: true },
        });
      }
    }

    throw new Error("Unknown Client-side Error", {
      cause: { type: "client", reason: "unknown", dontStore: true },
    });
  }

  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const evt of events) {
      for (const line of evt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let data: { type?: string; content?: string; error?: string };
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        if (data.type === "token") {
          acc += data.content ?? "";
          yield { role: "assistant", content: acc };
        } else if (data.type === "error") {
          throw new Error(data.error ?? "Stream failed");
        }
      }
    }
  }

  return {
    id: `stream-${Date.now()}`,
    sessionId: conversationId,
    role: "assistant",
    content: acc,
    createdAt: new Date().toISOString(),
  };
}
