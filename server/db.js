import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localDbPath = path.join(__dirname, '..', 'data', 'ecole.db');

let clientPromise;

function normalizeArgs(args) {
  return (args || []).map((a) => (typeof a === 'bigint' ? Number(a) : a));
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

async function createClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

  if (tursoUrl && !tursoUrl.startsWith('file:')) {
    const { createClient } = await import('@libsql/client/web');
    return createClient({ url: tursoUrl, authToken });
  }

  fs.mkdirSync(path.dirname(localDbPath), { recursive: true });
  const { createClient } = await import('@libsql/client');
  const url = tursoUrl?.startsWith('file:') ? tursoUrl : `file:${localDbPath}`;
  return createClient({ url });
}

export async function getClient() {
  if (!clientPromise) clientPromise = createClient();
  return clientPromise;
}

/** @returns {Promise<object|undefined>} */
export async function get(sql, args = []) {
  const client = await getClient();
  const result = await client.execute({ sql, args: normalizeArgs(args) });
  return result.rows[0] ? normalizeRow(result.rows[0]) : undefined;
}

/** @returns {Promise<object[]>} */
export async function all(sql, args = []) {
  const client = await getClient();
  const result = await client.execute({ sql, args: normalizeArgs(args) });
  return result.rows.map(normalizeRow);
}

/** @returns {Promise<{ changes: number, lastInsertRowid: number }>} */
export async function run(sql, args = []) {
  const client = await getClient();
  const result = await client.execute({ sql, args: normalizeArgs(args) });
  return {
    changes: Number(result.rowsAffected || 0),
    lastInsertRowid: Number(result.lastInsertRowid || 0)
  };
}

export async function exec(sql) {
  const client = await getClient();
  await client.executeMultiple(sql);
}

/** Execute several statements (best-effort atomic with batch write mode). */
export async function batch(statements) {
  const client = await getClient();
  const payload = statements.map((s) =>
    typeof s === 'string'
      ? { sql: s, args: [] }
      : { sql: s.sql, args: normalizeArgs(s.args || []) }
  );
  return client.batch(payload, 'write');
}

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('teacher', 'surveillance')),
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    email TEXT,
    subject TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    photo_path TEXT,
    points INTEGER DEFAULT 100,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    points_before INTEGER NOT NULL,
    points_change INTEGER NOT NULL,
    points_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS student_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('add', 'remove', 'edit')),
    student_name TEXT NOT NULL,
    class_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id INTEGER,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('add', 'edit', 'remove')),
    target_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS teacher_classes (
    user_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, class_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

const DEFAULT_SUBJECTS = [
  'Mathématiques',
  'Arabe',
  'Français',
  'Anglais',
  'Physique-Chimie',
  'SVT',
  'Histoire-Géographie',
  'Éducation islamique',
  'Informatique',
  'EPS',
  'Philosophie'
];

function isEconomie(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'economie';
}

let schemaReady;

export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await exec(SCHEMA_SQL);
    for (const sql of [
      'ALTER TABLE users ADD COLUMN email TEXT',
      'ALTER TABLE users ADD COLUMN subject TEXT'
    ]) {
      try {
        await run(sql);
      } catch {
        // column already exists
      }
    }
    try {
      await run(`
        INSERT INTO teacher_classes (user_id, class_id)
        SELECT u.id, c.id
        FROM users u
        CROSS JOIN classes c
        WHERE u.role = 'teacher'
          AND NOT EXISTS (
            SELECT 1 FROM teacher_classes tc WHERE tc.user_id = u.id
          )
      `);
    } catch {
      // ignore if tables are empty or already assigned
    }
    try {
      const existing = await all('SELECT name FROM subjects');
      const known = new Set(existing.map((row) => String(row.name || '').trim().toLowerCase()));
      const toInsert = [];
      if (!existing.length) {
        for (const name of DEFAULT_SUBJECTS) {
          if (!known.has(name.toLowerCase())) toInsert.push(name);
        }
      }
      const used = await all(`
        SELECT DISTINCT subject AS name FROM users
        WHERE role = 'teacher' AND subject IS NOT NULL AND TRIM(subject) != ''
      `);
      for (const row of used) {
        const name = String(row.name || '').trim();
        if (!name || isEconomie(name) || known.has(name.toLowerCase())) continue;
        if (toInsert.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
        toInsert.push(name);
      }
      for (const name of toInsert) {
        try {
          await run('INSERT INTO subjects (name) VALUES (?)', [name]);
          known.add(name.toLowerCase());
        } catch {
          // already exists
        }
      }
    } catch {
      // ignore if table is unavailable
    }
    try {
      await run('PRAGMA foreign_keys = ON');
    } catch {
      // ignore on remote HTTP clients that reject pragma
    }
  })();
  return schemaReady;
}

export default { get, all, run, exec, batch, getClient, ensureSchema };
