import { Request, Response, NextFunction } from 'express';
import { findSessionByToken } from '../repositories/session.js';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = header.slice(7);
  let session;
  try {
    session = await findSessionByToken(token);
  } catch (err) {
    return next(err);
  }
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.userId = session.user_id;
  req.username = session.username;
  next();
}
