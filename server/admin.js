import bcrypt from 'bcryptjs';
import { get, all, run, batch } from './db.js';

const VALID_ROLES = ['teacher', 'surveillance'];
export const MAX_POINTS = 100;

export async function recalculateStudentPoints(studentId) {
  const logs = await all(`
    SELECT points_change FROM point_logs
    WHERE student_id = ?
    ORDER BY created_at ASC, id ASC
  `, [studentId]);

  let points = MAX_POINTS;
  for (const log of logs) {
    points = Math.max(0, Math.min(MAX_POINTS, points + log.points_change));
  }

  await run('UPDATE students SET points = ? WHERE id = ?', [points, studentId]);
  return points;
}

export async function deletePointLog(actorId, logId, reason) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif de suppression est requis'), { status: 400 });
  }

  const log = await get('SELECT * FROM point_logs WHERE id = ?', [logId]);
  if (!log) throw Object.assign(new Error('Entrée introuvable'), { status: 404 });

  const student = await get('SELECT id FROM students WHERE id = ? AND active = 1', [log.student_id]);
  if (!student) throw Object.assign(new Error('Élève introuvable'), { status: 404 });

  await run('DELETE FROM point_logs WHERE id = ?', [logId]);
  const points = await recalculateStudentPoints(log.student_id);

  return { studentId: log.student_id, points };
}

export async function resetAllPoints(actorId, reason) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif est requis'), { status: 400 });
  }

  await batch([
    { sql: 'UPDATE students SET points = ? WHERE active = 1', args: [MAX_POINTS] },
    { sql: 'DELETE FROM point_logs', args: [] }
  ]);

  const count = (await get('SELECT COUNT(*) as count FROM students WHERE active = 1')).count;
  return { studentsUpdated: count };
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères';
  }
  return null;
}

async function countSurveillanceUsers(excludeId = null) {
  const row = excludeId
    ? await get(`SELECT COUNT(*) as count FROM users WHERE role = 'surveillance' AND id != ?`, [excludeId])
    : await get(`SELECT COUNT(*) as count FROM users WHERE role = 'surveillance'`);
  return row.count;
}

export async function getAdminStats() {
  const teachers = (await get(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'`)).count;
  const surveillance = (await get(`SELECT COUNT(*) as count FROM users WHERE role = 'surveillance'`)).count;
  const activeStudents = (await get(`SELECT COUNT(*) as count FROM students WHERE active = 1`)).count;
  const inactiveStudents = (await get(`SELECT COUNT(*) as count FROM students WHERE active = 0`)).count;
  const classes = (await get(`SELECT COUNT(*) as count FROM classes`)).count;
  const pointLogs = (await get(`SELECT COUNT(*) as count FROM point_logs`)).count;
  const studentLogs = (await get(`SELECT COUNT(*) as count FROM student_logs`)).count;
  const userLogs = (await get(`SELECT COUNT(*) as count FROM user_logs`)).count;

  return {
    users: { teachers, surveillance, total: teachers + surveillance },
    students: { active: activeStudents, inactive: inactiveStudents, total: activeStudents + inactiveStudents },
    classes,
    logs: { points: pointLogs, students: studentLogs, users: userLogs }
  };
}

export async function listAdminUsers(currentUserId) {
  const users = await all(`
    SELECT id, username, full_name, role, email, subject, created_at
    FROM users
    ORDER BY role DESC, full_name
  `);
  const links = await all(`
    SELECT tc.user_id, tc.class_id, c.name as class_name
    FROM teacher_classes tc
    JOIN classes c ON c.id = tc.class_id
    ORDER BY c.name
  `);
  const byUser = {};
  for (const link of links) {
    if (!byUser[link.user_id]) byUser[link.user_id] = { ids: [], names: [] };
    byUser[link.user_id].ids.push(link.class_id);
    byUser[link.user_id].names.push(link.class_name);
  }
  return users.map((user) => ({
    ...user,
    is_self: user.id === currentUserId,
    class_ids: byUser[user.id]?.ids || [],
    class_names: byUser[user.id]?.names || []
  }));
}

export async function listAdminClasses() {
  return all(`
    SELECT c.id, c.name, c.created_at,
           COUNT(s.id) as student_count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
    GROUP BY c.id
    ORDER BY c.name
  `);
}

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw Object.assign(new Error('Adresse e-mail invalide'), { status: 400 });
  }
  return value;
}

export async function userCanAccessClass(user, classId) {
  if (!user || classId == null) return false;
  if (user.role === 'surveillance') return true;
  const row = await get(
    'SELECT 1 AS ok FROM teacher_classes WHERE user_id = ? AND class_id = ?',
    [user.id, Number(classId)]
  );
  return Boolean(row);
}

export async function assertClassAccess(user, classId) {
  if (await userCanAccessClass(user, classId)) return;
  throw Object.assign(new Error('Accès non autorisé à cette classe'), { status: 403 });
}

export async function assertStudentAccess(user, student) {
  if (!student) throw Object.assign(new Error('Élève introuvable'), { status: 404 });
  await assertClassAccess(user, student.class_id);
}

export async function setTeacherClasses(userId, classIds) {
  const ids = [...new Set(
    (Array.isArray(classIds) ? classIds : [])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
  if (!ids.length) {
    throw Object.assign(new Error('Sélectionnez au moins une classe pour l\'enseignant'), { status: 400 });
  }
  const placeholders = ids.map(() => '?').join(',');
  const existing = await all(`SELECT id FROM classes WHERE id IN (${placeholders})`, ids);
  if (existing.length !== ids.length) {
    throw Object.assign(new Error('Une ou plusieurs classes sont introuvables'), { status: 400 });
  }
  await run('DELETE FROM teacher_classes WHERE user_id = ?', [userId]);
  for (const classId of ids) {
    await run('INSERT INTO teacher_classes (user_id, class_id) VALUES (?, ?)', [userId, classId]);
  }
  return ids;
}

export async function clearTeacherClasses(userId) {
  await run('DELETE FROM teacher_classes WHERE user_id = ?', [userId]);
}

export async function createAdminUser(actorId, { username, password, fullName, role, email, subject, classIds }) {
  if (!username?.trim() || !fullName?.trim()) {
    throw Object.assign(new Error('Nom et identifiant requis'), { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    throw Object.assign(new Error('Rôle invalide'), { status: 400 });
  }
  const mail = normalizeEmail(email);
  if (!mail) throw Object.assign(new Error('L\'e-mail est requis'), { status: 400 });
  const matter = role === 'teacher' ? String(subject || '').trim() : '';
  if (role === 'teacher' && !matter) {
    throw Object.assign(new Error('La matière est requise pour un enseignant'), { status: 400 });
  }
  const pwdError = validatePassword(password);
  if (pwdError) throw Object.assign(new Error(pwdError), { status: 400 });

  const existing = await get('SELECT id FROM users WHERE username = ?', [username.trim()]);
  if (existing) throw Object.assign(new Error('Ce nom d\'utilisateur existe déjà'), { status: 409 });
  const emailTaken = await get('SELECT id FROM users WHERE lower(email) = ?', [mail]);
  if (emailTaken) throw Object.assign(new Error('Cet e-mail est déjà utilisé'), { status: 409 });

  const hash = bcrypt.hashSync(password, 12);
  const result = await run(`
    INSERT INTO users (username, password_hash, full_name, role, email, subject)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [username.trim(), hash, fullName.trim(), role, mail, matter || null]);

  await run(`
    INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
    VALUES (?, ?, 'add', ?, ?)
  `, [result.lastInsertRowid, actorId, fullName.trim(), role === 'teacher' ? `Compte enseignant (${matter})` : 'Compte surveillance']);

  if (role === 'teacher') {
    await setTeacherClasses(result.lastInsertRowid, classIds);
  }

  return result.lastInsertRowid;
}

export async function updateAdminUser(actorId, userId, { username, password, fullName, role, email, subject, classIds }) {
  if (!username?.trim() || !fullName?.trim()) {
    throw Object.assign(new Error('Nom et identifiant requis'), { status: 400 });
  }
  if (role && !VALID_ROLES.includes(role)) {
    throw Object.assign(new Error('Rôle invalide'), { status: 400 });
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });

  const duplicate = await get('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), user.id]);
  if (duplicate) throw Object.assign(new Error('Ce nom d\'utilisateur existe déjà'), { status: 409 });

  const mail = normalizeEmail(email);
  if (!mail) throw Object.assign(new Error('L\'e-mail est requis'), { status: 400 });
  const emailTaken = await get('SELECT id FROM users WHERE lower(email) = ? AND id != ?', [mail, user.id]);
  if (emailTaken) throw Object.assign(new Error('Cet e-mail est déjà utilisé'), { status: 409 });

  const newRole = role || user.role;
  const matter = newRole === 'teacher' ? String(subject || '').trim() : '';
  if (newRole === 'teacher' && !matter) {
    throw Object.assign(new Error('La matière est requise pour un enseignant'), { status: 400 });
  }
  if (user.role === 'surveillance' && newRole !== 'surveillance' && (await countSurveillanceUsers(user.id)) === 0) {
    throw Object.assign(new Error('Impossible de retirer le dernier compte surveillance'), { status: 400 });
  }

  if (password) {
    const pwdError = validatePassword(password);
    if (pwdError) throw Object.assign(new Error(pwdError), { status: 400 });
    const hash = bcrypt.hashSync(password, 12);
    await run(
      'UPDATE users SET username = ?, full_name = ?, role = ?, email = ?, subject = ?, password_hash = ? WHERE id = ?',
      [username.trim(), fullName.trim(), newRole, mail, matter || null, hash, user.id]
    );
  } else {
    await run(
      'UPDATE users SET username = ?, full_name = ?, role = ?, email = ?, subject = ? WHERE id = ?',
      [username.trim(), fullName.trim(), newRole, mail, matter || null, user.id]
    );
  }

  await run(`
    INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
    VALUES (?, ?, 'edit', ?, ?)
  `, [user.id, actorId, fullName.trim(), newRole === 'teacher' ? `Mise à jour enseignant (${matter})` : 'Mise à jour du compte']);

  if (newRole === 'teacher') {
    await setTeacherClasses(user.id, classIds);
  } else {
    await clearTeacherClasses(user.id);
  }
}

export async function deleteAdminUser(actorId, userId, reason) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif de suppression est requis'), { status: 400 });
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
  if (user.id === actorId) {
    throw Object.assign(new Error('Vous ne pouvez pas supprimer votre propre compte'), { status: 400 });
  }
  if (user.role === 'surveillance' && (await countSurveillanceUsers(user.id)) === 0) {
    throw Object.assign(new Error('Impossible de supprimer le dernier compte surveillance'), { status: 400 });
  }

  await run('DELETE FROM teacher_classes WHERE user_id = ?', [user.id]);
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  await run(`
    INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
    VALUES (?, ?, 'remove', ?, ?)
  `, [user.id, actorId, user.full_name, reason.trim()]);
}

export async function createAdminClass(actorId, { name }) {
  if (!name?.trim()) {
    throw Object.assign(new Error('Nom de classe requis'), { status: 400 });
  }

  const existing = await get('SELECT id FROM classes WHERE name = ?', [name.trim()]);
  if (existing) throw Object.assign(new Error('Cette classe existe déjà'), { status: 409 });

  const result = await run('INSERT INTO classes (name) VALUES (?)', [name.trim()]);
  return result.lastInsertRowid;
}

export async function updateAdminClass(classId, { name }) {
  if (!name?.trim()) {
    throw Object.assign(new Error('Nom de classe requis'), { status: 400 });
  }

  const cls = await get('SELECT * FROM classes WHERE id = ?', [classId]);
  if (!cls) throw Object.assign(new Error('Classe introuvable'), { status: 404 });

  const duplicate = await get('SELECT id FROM classes WHERE name = ? AND id != ?', [name.trim(), classId]);
  if (duplicate) throw Object.assign(new Error('Cette classe existe déjà'), { status: 409 });

  await run('UPDATE classes SET name = ? WHERE id = ?', [name.trim(), classId]);
}

export async function deleteAdminClass(classId, { reason }) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif de suppression est requis'), { status: 400 });
  }

  const cls = await get('SELECT * FROM classes WHERE id = ?', [classId]);
  if (!cls) throw Object.assign(new Error('Classe introuvable'), { status: 404 });

  const students = (await get(
    'SELECT COUNT(*) as count FROM students WHERE class_id = ? AND active = 1',
    [classId]
  )).count;
  if (students > 0) {
    throw Object.assign(new Error('Impossible de supprimer une classe contenant des élèves actifs'), { status: 400 });
  }

  await run('DELETE FROM teacher_classes WHERE class_id = ?', [classId]);
  await run('DELETE FROM classes WHERE id = ?', [classId]);
}
