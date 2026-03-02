import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../data/db.js';
import { hashPassword } from './password.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
  createdAt: number;
  updatedAt: number;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: string | number;
  updated_at: string | number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function createUser(username: string, password: string, role: string = 'user'): Promise<User> {
  const p = getPool();
  const now = Date.now();
  const hash = await hashPassword(password);
  const id = uuidv4();

  const { rows } = await p.query<UserRow>(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, username, hash, role, now, now]
  );

  return rowToUser(rows[0]);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const p = getPool();
  const { rows } = await p.query<UserRow>(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const p = getPool();
  const { rows } = await p.query<UserRow>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

/**
 * Ensure root user exists with correct password hash.
 * Called at server startup. Uses ROOT_PASSWORD env var (default: "admin").
 */
export async function ensureRootUser(): Promise<void> {
  const p = getPool();
  const rootPassword = process.env.ROOT_PASSWORD || 'admin';
  const hash = await hashPassword(rootPassword);
  const now = Date.now();

  await p.query(
    `UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = 'root'`,
    [hash, now]
  );
}
