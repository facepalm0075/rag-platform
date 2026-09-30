import { pool } from '../db/pool.js';
import { User } from '../types/index.js';

export async function createUser(username: string, passwordHash: string): Promise<User> {
  const result = await pool.query<User>(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
    [username, passwordHash]
  );
  return result.rows[0];
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0];
}

export async function findUserById(id: string): Promise<User | undefined> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
}
