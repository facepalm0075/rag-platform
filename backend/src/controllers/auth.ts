import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import * as authService from '../services/auth.js';

export async function register(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body;
    const result = await authService.register(username, password);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body;
    const result = await authService.login(username, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization!;
    const token = header.slice(7);
    await authService.logout(token);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await authService.getMe(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
