import bcrypt from 'bcryptjs';
import db from './db.js';

const VALID_ROLES = ['teacher', 'surveillance'];
export const MAX_POINTS = 100;

export function recalculateStudentPoints(studentId) {
  const logs = db.prepare(`
    SELECT points_change FROM point_logs
    WHERE student_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(studentId);

  let points = MAX_POINTS;
  for (const log of logs) {
    points = Math.max(0, Math.min(MAX_POINTS, points + log.points_change));
  }

  db.prepare('UPDATE students SET points = ? WHERE id = ?').run(points, studentId);
  return points;
}

export function deletePointLog(actorId, logId, reason) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif de suppression est requis'), { status: 400 });
  }

  const log = db.prepare('SELECT * FROM point_logs WHERE id = ?').get(logId);
  if (!log) throw Object.assign(new Error('Entrée introuvable'), { status: 404 });

  const student = db.prepare('SELECT id FROM students WHERE id = ? AND active = 1').get(log.student_id);
  if (!student) throw Object.assign(new Error('Élève introuvable'), { status: 404 });

  db.prepare('DELETE FROM point_logs WHERE id = ?').run(logId);
  const points = recalculateStudentPoints(log.student_id);

  return { studentId: log.student_id, points };
}

export function resetAllPoints(actorId, reason) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif est requis'), { status: 400 });
  }

  const reset = db.transaction(() => {
    db.prepare('UPDATE students SET points = ? WHERE active = 1').run(MAX_POINTS);
    db.prepare('DELETE FROM point_logs').run();
  });
  reset();

  const count = db.prepare('SELECT COUNT(*) as count FROM students WHERE active = 1').get().count;
  return { studentsUpdated: count };
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères';
  }
  return null;
}

function countSurveillanceUsers(excludeId = null) {
  const row = excludeId
    ? db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'surveillance' AND id != ?`).get(excludeId)
    : db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'surveillance'`).get();
  return row.count;
}

export function getAdminStats() {
  const teachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'`).get().count;
  const surveillance = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'surveillance'`).get().count;
  const activeStudents = db.prepare(`SELECT COUNT(*) as count FROM students WHERE active = 1`).get().count;
  const inactiveStudents = db.prepare(`SELECT COUNT(*) as count FROM students WHERE active = 0`).get().count;
  const classes = db.prepare(`SELECT COUNT(*) as count FROM classes`).get().count;
  const pointLogs = db.prepare(`SELECT COUNT(*) as count FROM point_logs`).get().count;
  const studentLogs = db.prepare(`SELECT COUNT(*) as count FROM student_logs`).get().count;
  const userLogs = db.prepare(`SELECT COUNT(*) as count FROM user_logs`).get().count;

  return {
    users: { teachers, surveillance, total: teachers + surveillance },
    students: { active: activeStudents, inactive: inactiveStudents, total: activeStudents + inactiveStudents },
    classes,
    logs: { points: pointLogs, students: studentLogs, users: userLogs }
  };
}

export function listAdminUsers(currentUserId) {
  return db.prepare(`
    SELECT id, username, full_name, role, created_at
    FROM users
    ORDER BY role DESC, full_name
  `).all().map(user => ({
    ...user,
    is_self: user.id === currentUserId
  }));
}

export function listAdminClasses() {
  return db.prepare(`
    SELECT c.id, c.name, c.created_at,
           COUNT(s.id) as student_count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
    GROUP BY c.id
    ORDER BY c.name
  `).all();
}

export function createAdminUser(actorId, { username, password, fullName, role, reason }) {
  if (!username?.trim() || !fullName?.trim() || !reason?.trim()) {
    throw Object.assign(new Error('Tous les champs sont requis, y compris le motif'), { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    throw Object.assign(new Error('Rôle invalide'), { status: 400 });
  }
  const pwdError = validatePassword(password);
  if (pwdError) throw Object.assign(new Error(pwdError), { status: 400 });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) throw Object.assign(new Error('Ce nom d\'utilisateur existe déjà'), { status: 409 });

  const hash = bcrypt.hashSync(password, 12);

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, ?)
    `).run(username.trim(), hash, fullName.trim(), role);

    db.prepare(`
      INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
      VALUES (?, ?, 'add', ?, ?)
    `).run(result.lastInsertRowid, actorId, fullName.trim(), reason.trim());

    return result.lastInsertRowid;
  });

  return insert();
}

export function updateAdminUser(actorId, userId, { username, password, fullName, role, reason }) {
  if (!username?.trim() || !fullName?.trim() || !reason?.trim()) {
    throw Object.assign(new Error('Nom, identifiant et motif requis'), { status: 400 });
  }
  if (role && !VALID_ROLES.includes(role)) {
    throw Object.assign(new Error('Rôle invalide'), { status: 400 });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });

  const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), user.id);
  if (duplicate) throw Object.assign(new Error('Ce nom d\'utilisateur existe déjà'), { status: 409 });

  const newRole = role || user.role;
  if (user.role === 'surveillance' && newRole !== 'surveillance' && countSurveillanceUsers(user.id) === 0) {
    throw Object.assign(new Error('Impossible de retirer le dernier compte surveillance'), { status: 400 });
  }

  const update = db.transaction(() => {
    if (password) {
      const pwdError = validatePassword(password);
      if (pwdError) throw Object.assign(new Error(pwdError), { status: 400 });
      const hash = bcrypt.hashSync(password, 12);
      db.prepare('UPDATE users SET username = ?, full_name = ?, role = ?, password_hash = ? WHERE id = ?')
        .run(username.trim(), fullName.trim(), newRole, hash, user.id);
    } else {
      db.prepare('UPDATE users SET username = ?, full_name = ?, role = ? WHERE id = ?')
        .run(username.trim(), fullName.trim(), newRole, user.id);
    }

    db.prepare(`
      INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
      VALUES (?, ?, 'edit', ?, ?)
    `).run(user.id, actorId, fullName.trim(), reason.trim());
  });

  update();
}

export function deleteAdminUser(actorId, userId, reason) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif de suppression est requis'), { status: 400 });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
  if (user.id === actorId) {
    throw Object.assign(new Error('Vous ne pouvez pas supprimer votre propre compte'), { status: 400 });
  }
  if (user.role === 'surveillance' && countSurveillanceUsers(user.id) === 0) {
    throw Object.assign(new Error('Impossible de supprimer le dernier compte surveillance'), { status: 400 });
  }

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    db.prepare(`
      INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
      VALUES (?, ?, 'remove', ?, ?)
    `).run(user.id, actorId, user.full_name, reason.trim());
  });
  remove();
}

export function createAdminClass(actorId, { name, reason }) {
  if (!name?.trim() || !reason?.trim()) {
    throw Object.assign(new Error('Nom de classe et motif requis'), { status: 400 });
  }

  const existing = db.prepare('SELECT id FROM classes WHERE name = ?').get(name.trim());
  if (existing) throw Object.assign(new Error('Cette classe existe déjà'), { status: 409 });

  const result = db.prepare('INSERT INTO classes (name) VALUES (?)').run(name.trim());
  return result.lastInsertRowid;
}

export function updateAdminClass(classId, { name, reason }) {
  if (!name?.trim() || !reason?.trim()) {
    throw Object.assign(new Error('Nom de classe et motif requis'), { status: 400 });
  }

  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!cls) throw Object.assign(new Error('Classe introuvable'), { status: 404 });

  const duplicate = db.prepare('SELECT id FROM classes WHERE name = ? AND id != ?').get(name.trim(), classId);
  if (duplicate) throw Object.assign(new Error('Cette classe existe déjà'), { status: 409 });

  db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name.trim(), classId);
}

export function deleteAdminClass(classId, { reason }) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('Un motif de suppression est requis'), { status: 400 });
  }

  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!cls) throw Object.assign(new Error('Classe introuvable'), { status: 404 });

  const students = db.prepare('SELECT COUNT(*) as count FROM students WHERE class_id = ? AND active = 1').get(classId).count;
  if (students > 0) {
    throw Object.assign(new Error('Impossible de supprimer une classe contenant des élèves actifs'), { status: 400 });
  }

  db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
}
