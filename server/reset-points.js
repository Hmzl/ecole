import { get, run } from './db.js';
import { MAX_POINTS } from './admin.js';

await run('UPDATE students SET points = ? WHERE active = 1', [MAX_POINTS]);
await run('DELETE FROM point_logs');

const count = (await get('SELECT COUNT(*) as count FROM students WHERE active = 1')).count;
console.log(`${count} élève(s) réinitialisé(s) à ${MAX_POINTS} points. Historique effacé.`);
