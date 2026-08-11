/**
 * Remplace les élèves et classes par la liste ListEleve_20260707.pdf
 */
import db from './db.js';
import { CLASSES_ELEVES } from './students-list.js';

const replace = db.transaction(() => {
  db.prepare('UPDATE students SET active = 0').run();

  const existingClasses = db.prepare('SELECT id, name FROM classes').all();
  const classByName = new Map(existingClasses.map((c) => [c.name, c.id]));
  const insertClass = db.prepare('INSERT INTO classes (name) VALUES (?)');
  const renameClass = db.prepare('UPDATE classes SET name = ? WHERE id = ?');
  const insertStudent = db.prepare(`
    INSERT INTO students (class_id, first_name, last_name, points, active)
    VALUES (?, ?, ?, 100, 1)
  `);

  const usedClassIds = new Set();

  for (const { className, students } of CLASSES_ELEVES) {
    let classId = classByName.get(className);
    if (!classId) {
      // Réutiliser une ancienne classe si possible (évite classes orphelines inutiles)
      const reusable = existingClasses.find((c) => !usedClassIds.has(c.id) && !CLASSES_ELEVES.some((x) => x.className === c.name));
      if (reusable) {
        renameClass.run(className, reusable.id);
        classId = reusable.id;
        classByName.set(className, classId);
        classByName.delete(reusable.name);
      } else {
        classId = insertClass.run(className).lastInsertRowid;
        classByName.set(className, classId);
      }
    }
    usedClassIds.add(classId);

    for (const { firstName, lastName } of students) {
      insertStudent.run(classId, firstName, lastName);
    }
  }

  // Désactiver / retirer les classes hors liste qui n'ont plus d'élèves actifs
  // (on garde la ligne pour l'historique des logs)
});

replace();

const summary = CLASSES_ELEVES.map(({ className, students }) => {
  const row = db.prepare(`
    SELECT c.id, COUNT(s.id) as count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
    WHERE c.name = ?
    GROUP BY c.id
  `).get(className);
  return `${className}: ${row?.count ?? 0} élève(s) (attendu ${students.length})`;
});

console.log('Remplacement terminé.');
summary.forEach((line) => console.log(' ', line));
console.log(
  'Total actifs:',
  db.prepare('SELECT COUNT(*) as c FROM students WHERE active = 1').get().c
);
