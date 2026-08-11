import db from './db.js';
import { MAX_POINTS } from './admin.js';

const reset = db.transaction(() => {
  db.prepare('UPDATE students SET points = ? WHERE active = 1').run(MAX_POINTS);
  db.prepare('DELETE FROM point_logs').run();
});

reset();

const count = db.prepare('SELECT COUNT(*) as count FROM students WHERE active = 1').get().count;
console.log(`${count} élève(s) réinitialisé(s) à ${MAX_POINTS} points. Historique effacé.`);
