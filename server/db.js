import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'ecole.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
`);

const studentLogsSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='student_logs'"
).get()?.sql || '';

if (studentLogsSql && !studentLogsSql.includes("'edit'")) {
  db.exec(`
    CREATE TABLE student_logs_new (
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
    INSERT INTO student_logs_new SELECT * FROM student_logs;
    DROP TABLE student_logs;
    ALTER TABLE student_logs_new RENAME TO student_logs;
  `);
}

export default db;
