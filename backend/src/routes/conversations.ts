import { Router } from 'express';
import { z } from 'zod';
import { validate, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as conversationController from '../controllers/conversations.js';

const router = Router();

const createSchema = z.object({
  title: z.string().max(255).optional(),
});

const updateTitleSchema = z.object({
  title: z.string().min(1).max(255),
});

const messageSchema = z.object({
  content: z.string().min(1),
});

const historyScopeSchema = z
  .object({
    from: z.coerce.number().int().min(1).optional(),
    to: z.coerce.number().int().min(1).optional(),
  })
  .refine((s) => (s.from === undefined) === (s.to === undefined), {
    message: 'from and to must be provided together',
  })
  .refine((s) => s.from === undefined || s.to! >= s.from!, {
    message: 'to must be greater than or equal to from',
  });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.post('/', requireAuth, validate(createSchema), conversationController.create);
router.get('/', requireAuth, validateQuery(listQuerySchema), conversationController.list);
router.get('/:id', requireAuth, validateQuery(historyScopeSchema), conversationController.get);
router.get('/:id/chunks', requireAuth, validateQuery(listQuerySchema), conversationController.getChunks);
router.patch('/:id', requireAuth, validate(updateTitleSchema), conversationController.updateTitle);
router.delete('/:id', requireAuth, conversationController.remove);
router.post('/:id/messages', requireAuth, validate(messageSchema), conversationController.sendMessage);

export default router;
