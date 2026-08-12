import bcrypt from 'bcryptjs';
import { ensureSchema, get, run } from './db.js';
import { ensureUploadsDir } from './storage.js';
import { CLASSES_ELEVES } from './students-list.js';

ensureUploadsDir();

await ensureSchema();

const userCount = (await get('SELECT COUNT(*) as count FROM users')).count;

if (userCount === 0) {
  const hashTeacher = bcrypt.hashSync('Enseignant123!', 12);
  const hashSurveillance = bcrypt.hashSync('Surveillance123!', 12);

  await run(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    ['prof.martin', hashTeacher, 'Marie Martin', 'teacher']
  );
  await run(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    ['prof.dubois', hashTeacher, 'Pierre Dubois', 'teacher']
  );
  await run(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    ['surveillance', hashSurveillance, 'Direction Surveillance', 'surveillance']
  );

  for (const { className, students } of CLASSES_ELEVES) {
    const { lastInsertRowid: classId } = await run('INSERT INTO classes (name) VALUES (?)', [className]);
    for (const { firstName, lastName } of students) {
      await run(
        'INSERT INTO students (class_id, first_name, last_name, points) VALUES (?, ?, ?, 100)',
        [classId, firstName, lastName]
      );
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
