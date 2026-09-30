import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { registerUser } from '../helpers/http.js';
import { truncateAll, waitFor } from '../helpers/db.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'changeme';

async function logCountWhere(where: string, params: unknown[]): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM system_logs WHERE ${where}`, params);
  return result.rows[0].count;
}

describe('admin dashboard', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(() => pool.end());

  it('renders the sign-in page', async () => {
    const res = await request(app).get('/admin/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Sign in');
    expect(res.text).toContain('name="username"');
    expect(res.text).toContain('name="password"');
  });

  it('blocks the dashboard without a session cookie', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(401);
    expect(res.text).toContain('Sign in');
  });

  it('rejects wrong credentials and logs the failure', async () => {
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ username: ADMIN_USERNAME, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid username or password');

    await waitFor(async () => (await logCountWhere(`category = 'admin' AND level = 'warn'`, [])) === 1);
    expect(await logCountWhere(`category = 'admin' AND level = 'warn' AND message = 'Admin sign-in failed'`, []))
      .toBe(1);
  });

  it('signs in with valid credentials and grants dashboard access', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/admin');
    expect(login.headers['set-cookie']).toBeDefined();

    const dashboard = await agent.get('/admin');
    expect(dashboard.status).toBe(200);
    expect(dashboard.text).toContain('System Report');
  });

  it('reports API activity (registrations, logins, ingests)', async () => {
    await registerUser(app, 'reporteduser');

    const agent = request.agent(app);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    await waitFor(async () => (await logCountWhere(`message = 'User registered' AND username = 'reporteduser'`, [])) === 1);

    const res = await agent.get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('reporteduser');
    expect(res.text).toContain('User registered');

    const filtered = await agent.get('/admin?category=auth&level=info');
    expect(filtered.status).toBe(200);
    expect(filtered.text).toContain('User registered');
    expect(filtered.text).not.toContain('Admin signed in');
  });

  it('supports pagination on the report page', async () => {
    const agent = request.agent(app);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    for (let i = 1; i <= 55; i++) {
      await pool.query(
        `INSERT INTO system_logs (level, category, message) VALUES ('info', 'app', $1)`,
        [`bulk entry ${i}`]
      );
    }

    const page1 = await agent.get('/admin');
    expect(page1.status).toBe(200);
    expect(page1.text).toContain('Page 1 of 2');
    expect(page1.text).toContain('bulk entry 55');

    const page2 = await agent.get('/admin?page=2');
    expect(page2.status).toBe(200);
    expect(page2.text).toContain('Page 2 of 2');
    expect(page2.text).toContain('bulk entry 1');
  });

  it('logs out and revokes dashboard access', async () => {
    const agent = request.agent(app);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const logout = await agent.get('/admin/logout');
    expect(logout.status).toBe(302);
    expect(logout.headers.location).toBe('/admin/login');

    const after = await agent.get('/admin');
    expect(after.status).toBe(401);
  });
});
