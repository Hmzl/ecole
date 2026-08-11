import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { CLASSES_ELEVES } from './students-list.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'ecole.db');
const uploadsDir = path.join(__dirname, '..', 'uploads');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('teacher', 'surveillance')),
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
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
`);

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

if (userCount === 0) {
  const hashTeacher = bcrypt.hashSync('Enseignant123!', 12);
  const hashSurveillance = bcrypt.hashSync('Surveillance123!', 12);

  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)
  `).run('prof.martin', hashTeacher, 'Marie Martin', 'teacher');

  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)
  `).run('prof.dubois', hashTeacher, 'Pierre Dubois', 'teacher');

  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)
  `).run('surveillance', hashSurveillance, 'Direction Surveillance', 'surveillance');

  const insertClass = db.prepare('INSERT INTO classes (name) VALUES (?)');
  const insertStudent = db.prepare(`
    INSERT INTO students (class_id, first_name, last_name, points) VALUES (?, ?, ?, 100)
  `);

  for (const { className, students } of CLASSES_ELEVES) {
    const classId = insertClass.run(className).lastInsertRowid;
    for (const { firstName, lastName } of students) {
      insertStudent.run(classId, firstName, lastName);
    }
  }

  console.log('Base de données initialisée avec succès.');
  console.log('');
  console.log('Comptes de démonstration :');
  console.log('  Enseignant  : prof.martin / Enseignant123!');
  console.log('  Enseignant  : prof.dubois / Enseignant123!');
  console.log('  Surveillance: surveillance / Surveillance123!');
} else {
  console.log('Base de données déjà initialisée.');
}

db.close();
