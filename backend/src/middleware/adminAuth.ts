import { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessions = new Map<string, number>();

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  const expectedUser = digest(config.ADMIN_USERNAME);
  const expectedPass = digest(config.ADMIN_PASSWORD);
  return safeEqual(digest(username), expectedUser) && safeEqual(digest(password), expectedPass);
}

export function createAdminSession(): string {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function destroyAdminSession(token: string): void {
  sessions.delete(token);
}

export function isAdminSessionValid(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function getSessionToken(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!isAdminSessionValid(token)) {
    if (req.path === '/login') return next();
    res.status(401).send('Unauthorized. <a href="/admin/login">Sign in</a>');
    return;
  }
  next();
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}
