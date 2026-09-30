import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { createUser, findUserByUsername, findUserById } from '../repositories/user.js';
import { createSession, findSessionByToken, deleteSessionByToken } from '../repositories/session.js';
import { seedExampleData } from './seedExample.js';
import { AuthPayload } from '../types/index.js';
import { ApiError } from '../errors.js';
import { log } from '../logging/index.js';

export async function register(username: string, password: string): Promise<AuthPayload> {
  const existing = await findUserByUsername(username);
  if (existing) {
    log('warn', 'Registration failed: username already taken', { username }, 'auth');
    throw ApiError.conflict('Username already taken');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await createUser(username, passwordHash);

  const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.SESSION_EXPIRY_DAYS);

  await createSession(user.id, token, expiresAt);
  void seedExampleData(user.id);

  log('info', 'User registered', { userId: user.id, username }, 'auth');

  const { password_hash, ...safeUser } = user;
  return { user: safeUser, token };
}

export async function login(username: string, password: string): Promise<AuthPayload> {
  const user = await findUserByUsername(username);
  if (!user) {
    log('warn', 'Login failed: unknown user', { username }, 'auth');
    ApiError.unauthorized("Invalid credentials");
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    log('warn', 'Login failed: wrong password', { userId: user.id, username }, 'auth');
    ApiError.unauthorized("Invalid credentials");
  }

  const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.SESSION_EXPIRY_DAYS);

  await createSession(user.id, token, expiresAt);

  log('info', 'User logged in', { userId: user.id, username }, 'auth');

  const { password_hash, ...safeUser } = user;
  return { user: safeUser, token };
}

export async function logout(token: string): Promise<void> {
  await deleteSessionByToken(token);
  log('info', 'User logged out', { token: token.slice(0, 8) }, 'auth');
}

export async function getMe(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw ApiError.notFound('User not found');
  const { password_hash, ...safeUser } = user;
  return { user: safeUser };
}

export async function validateToken(token: string) {
  return findSessionByToken(token);
}
