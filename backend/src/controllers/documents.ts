import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import * as documentService from '../services/documents.js';
import { Chunk } from '../types/index.js';

function stripEmbeddings(chunks: Chunk[]): Omit<Chunk, 'embedding'>[] {
  return chunks.map(({ embedding: _embedding, ...rest }) => rest);
}

export async function ingest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { conversation_id, ...input } = req.body;
    const result = await documentService.ingestDocument(req.userId!, conversation_id, input);
    res.status(201).json({ ...result, chunks: stripEmbeddings(result.chunks) });
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { limit, offset, conversation_id } = req.query as { limit?: number; offset?: number; conversation_id?: string };
    const documents = await documentService.listDocuments(req.userId!, { limit, offset, conversationId: conversation_id });
    res.json(documents);
  } catch (err) {
    next(err);
  }
}

export async function get(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { include_embeddings } = req.query as { include_embeddings?: boolean };
    const result = await documentService.getDocument(req.userId!, req.params.id, include_embeddings);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await documentService.removeDocument(req.userId!, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
