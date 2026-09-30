import { Router } from 'express';
import { z } from 'zod';
import { validate, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as documentController from '../controllers/documents.js';

const router = Router();

const chunkSchema = z.object({
  content: z.string().min(1),
  chunk_index: z.number().int().min(0),
  heading: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ingestSchema = z.object({
  title: z.string().min(1).max(255),
  conversation_id: z.string().uuid(),
  source_type: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
  chunks: z.array(chunkSchema).min(1),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  conversation_id: z.string().uuid().optional(),
});

const getQuerySchema = listQuerySchema.extend({
  include_embeddings: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

router.post('/', requireAuth, validate(ingestSchema), documentController.ingest);
router.get('/', requireAuth, validateQuery(listQuerySchema), documentController.list);
router.get('/:id', requireAuth, validateQuery(getQuerySchema), documentController.get);
router.delete('/:id', requireAuth, documentController.remove);

export default router;
