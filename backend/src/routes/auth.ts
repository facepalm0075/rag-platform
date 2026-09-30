import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as authController from '../controllers/auth.js';

const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(6).max(255),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

export default router;
