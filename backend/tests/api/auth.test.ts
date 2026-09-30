import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { registerUser } from '../helpers/http.js';
import { truncateAll, waitFor } from '../helpers/db.js';
import { mockDefaultWorkerBehavior } from '../helpers/workerMock.js';

const workerMock = vi.hoisted(() => ({ rpc: vi.fn(), rpcChatStream: vi.fn() }));
vi.mock('../../src/services/workerPool.js', () => ({ workerPool: workerMock }));

async function registerAndWaitSeeded(username: string) {
  const auth = await registerUser(app, username);
  await waitFor(async () => {
    const rows = await pool.query(
      `SELECT COUNT(*)::int AS n FROM conversations c
       JOIN users u ON u.id = c.user_id
       WHERE u.username = $1`,
      [username]
    );
    return rows.rows[0].n === 1;
  });
  return auth;
}

describe('auth API', () => {
  beforeEach(async () => {
    await truncateAll();
    mockDefaultWorkerBehavior(workerMock);
  });
  afterAll(() => pool.end());

  it('registers a user and returns a token without exposing the password hash', async () => {
    const { token, user } = await registerAndWaitSeeded('alice');

    expect(user.username).toBe('alice');
    expect(user).not.toHaveProperty('password_hash');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('asynchronously seeds example data for the new user', async () => {
    const { token } = await registerUser(app, 'seedy');

    await waitFor(async () => {
      const rows = await pool.query(
        `SELECT COUNT(*)::int AS n FROM conversations c
         JOIN users u ON u.id = c.user_id
         WHERE u.username = 'seedy'`
      );
      return rows.rows[0].n === 1;
    });

    const convs = await pool.query(
      `SELECT c.id FROM conversations c JOIN users u ON u.id = c.user_id WHERE u.username = 'seedy'`
    );
    const docs = await pool.query(
      `SELECT COUNT(*)::int AS n FROM documents WHERE conversation_id = $1`,
      [convs.rows[0].id]
    );
    expect(docs.rows[0].n).toBe(1);
    expect(workerMock.rpc).toHaveBeenCalled();

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
  });

  it('rejects duplicate usernames', async () => {
    await registerAndWaitSeeded('dupe');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'dupe', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already taken');
  });

  it('validates register payload', async () => {
    const shortUser = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', password: 'password123' });
    expect(shortUser.status).toBe(400);

    const shortPass = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validname', password: '123' });
    expect(shortPass.status).toBe(400);
  });

  it('logs in with valid credentials', async () => {
    await registerAndWaitSeeded('loginuser');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'loginuser', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('loginuser');
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong passwords and unknown users', async () => {
    await registerAndWaitSeeded('locked');

    const wrongPass = await request(app)
      .post('/api/auth/login')
      .send({ username: 'locked', password: 'wrongpass' });
    expect(wrongPass.status).toBe(401);

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'whatever1' });
    expect(unknown.status).toBe(401);
  });

  it('returns the current user via /me', async () => {
    const { token } = await registerAndWaitSeeded('myself');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('myself');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const noHeader = await request(app).get('/api/auth/me');
    expect(noHeader.status).toBe(401);

    const badToken = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(badToken.status).toBe(401);
  });

  it('logout invalidates the session token', async () => {
    const { token } = await registerAndWaitSeeded('bye');

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });
});
