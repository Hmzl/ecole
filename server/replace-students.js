/**
 * Remplace les élèves et classes par students-list.js (usage local / script).
 */
import { CLASSES_ELEVES } from './students-list.js';
import { applyStudentImport } from './import-students.js';
import { ensureSchema, get } from './db.js';

await ensureSchema();
const result = await applyStudentImport(1, CLASSES_ELEVES);

for (const { className, students } of CLASSES_ELEVES) {
  const row = await get(`
    SELECT COUNT(s.id) as count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
    WHERE c.name = ?
  `, [className]);
  console.log(`  ${className}: ${row?.count ?? 0} élève(s) (attendu ${students.length})`);
}

console.log('Remplacement terminé.');
console.log(`Total importé: ${result.imported}`);
