import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';
import { signToken, authMiddleware, requireRole } from './auth.js';
import {
  getAdminStats, listAdminUsers, listAdminClasses,
  createAdminUser, updateAdminUser, deleteAdminUser,
  createAdminClass, updateAdminClass, deleteAdminClass,
  deletePointLog, resetAllPoints, MAX_POINTS
} from './admin.js';
import { parseStudentsFile, applyStudentImport } from './import-students.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format d\'image non supporté'));
  }
});

const uploadImport = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.docx', '.pdf'].includes(ext)) cb(null, true);
    else cb(new Error('Formats acceptés : Excel (.xlsx), Word (.docx), PDF'));
  }
});

// ─── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = signToken({
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role
    }
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ─── Classes ────────────────────────────────────────────────────────────────

app.get('/api/classes', authMiddleware, (_req, res) => {
  const classes = db.prepare(`
    SELECT c.*, COUNT(s.id) as student_count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
    GROUP BY c.id
    ORDER BY c.name
  `).all();
  res.json(classes);
});

// ─── Students ───────────────────────────────────────────────────────────────

app.get('/api/classes/:classId/students', authMiddleware, (req, res) => {
  const students = db.prepare(`
    SELECT id, class_id, first_name, last_name, photo_path, points
    FROM students
    WHERE class_id = ? AND active = 1
    ORDER BY last_name, first_name
  `).all(req.params.classId);
  res.json(students);
});

app.get('/api/students/:id', authMiddleware, (req, res) => {
  const student = db.prepare(`
    SELECT id, class_id, first_name, last_name, photo_path, points
    FROM students WHERE id = ? AND active = 1
  `).get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });
  res.json(student);
});

app.post('/api/students/:id/points', authMiddleware, requireRole('teacher', 'surveillance'), (req, res) => {
  const { change, reason } = req.body;
  const delta = parseInt(change, 10);

  if (isNaN(delta) || delta === 0) {
    return res.status(400).json({ error: 'Modification de points invalide' });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ error: 'Une description du changement est requise' });
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  const pointsBefore = Number(student.points) || 0;
  const pointsAfter = Math.max(0, Math.min(MAX_POINTS, pointsBefore + delta));
  const appliedDelta = pointsAfter - pointsBefore;

  const update = db.transaction(() => {
    db.prepare('UPDATE students SET points = ? WHERE id = ?').run(pointsAfter, student.id);
    db.prepare(`
      INSERT INTO point_logs (student_id, user_id, points_before, points_change, points_after, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(student.id, req.user.id, pointsBefore, appliedDelta, pointsAfter, reason.trim());
  });
  update();

  res.json({
    id: student.id,
    points: pointsAfter,
    change: delta,
    message: 'Points mis à jour'
  });
});

app.post('/api/students', authMiddleware, requireRole('surveillance'), upload.single('photo'), (req, res) => {
  const { classId, firstName, lastName, reason } = req.body;

  if (!classId || !firstName?.trim() || !lastName?.trim() || !reason?.trim()) {
    return res.status(400).json({ error: 'Tous les champs sont requis, y compris le motif' });
  }

  const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable' });

  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO students (class_id, first_name, last_name, photo_path, points)
      VALUES (?, ?, ?, ?, 100)
    `).run(classId, firstName.trim(), lastName.trim(), photoPath);

    db.prepare(`
      INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
      VALUES (?, ?, 'add', ?, ?, ?)
    `).run(result.lastInsertRowid, req.user.id, `${firstName.trim()} ${lastName.trim()}`, classId, reason.trim());

    return result.lastInsertRowid;
  });

  const studentId = insert();

  res.status(201).json({
    id: studentId,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    photoPath,
    points: 100,
    message: 'Élève ajouté avec succès'
  });
});

app.delete('/api/students/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) {
    return res.status(400).json({ error: 'Un motif de suppression est requis' });
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  const remove = db.transaction(() => {
    db.prepare('UPDATE students SET active = 0 WHERE id = ?').run(student.id);
    db.prepare(`
      INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
      VALUES (?, ?, 'remove', ?, ?, ?)
    `).run(student.id, req.user.id, `${student.first_name} ${student.last_name}`, student.class_id, reason.trim());
  });
  remove();

  res.json({ message: 'Élève supprimé' });
});

app.post('/api/students/:id/photo', authMiddleware, requireRole('surveillance'), upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });

  const student = db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  const photoPath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE students SET photo_path = ? WHERE id = ?').run(photoPath, student.id);

  res.json({ photoPath });
});

app.put('/api/students/:id', authMiddleware, requireRole('surveillance'), upload.single('photo'), (req, res) => {
  const { classId, firstName, lastName } = req.body;

  if (!classId || !firstName?.trim() || !lastName?.trim()) {
    return res.status(400).json({ error: 'Prénom, nom et classe sont requis' });
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable' });

  const photoPath = req.file ? `/uploads/${req.file.filename}` : student.photo_path;
  const reason = 'Modification de l\'élève';

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE students SET class_id = ?, first_name = ?, last_name = ?, photo_path = ?
      WHERE id = ?
    `).run(classId, firstName.trim(), lastName.trim(), photoPath, student.id);

    db.prepare(`
      INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
      VALUES (?, ?, 'edit', ?, ?, ?)
    `).run(student.id, req.user.id, `${firstName.trim()} ${lastName.trim()}`, classId, reason);
  });
  update();

  res.json({
    id: student.id,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    classId: parseInt(classId, 10),
    photoPath,
    message: 'Élève modifié avec succès'
  });
});

// ─── Teachers (surveillance) ────────────────────────────────────────────────

app.get('/api/teachers', authMiddleware, requireRole('surveillance'), (_req, res) => {
  const teachers = db.prepare(`
    SELECT id, username, full_name, created_at
    FROM users WHERE role = 'teacher'
    ORDER BY full_name
  `).all();
  res.json(teachers);
});

app.post('/api/teachers', authMiddleware, requireRole('surveillance'), (req, res) => {
  const { username, password, fullName, reason } = req.body;

  if (!username?.trim() || !password || !fullName?.trim() || !reason?.trim()) {
    return res.status(400).json({ error: 'Tous les champs sont requis, y compris le motif' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });

  const hash = bcrypt.hashSync(password, 12);

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, 'teacher')
    `).run(username.trim(), hash, fullName.trim());

    db.prepare(`
      INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
      VALUES (?, ?, 'add', ?, ?)
    `).run(result.lastInsertRowid, req.user.id, fullName.trim(), reason.trim());

    return result.lastInsertRowid;
  });

  const teacherId = insert();

  res.status(201).json({
    id: teacherId,
    username: username.trim(),
    fullName: fullName.trim(),
    message: 'Enseignant ajouté avec succès'
  });
});

app.put('/api/teachers/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  const { username, password, fullName, reason } = req.body;

  if (!username?.trim() || !fullName?.trim() || !reason?.trim()) {
    return res.status(400).json({ error: 'Nom, identifiant et motif requis' });
  }

  const teacher = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'teacher');
  if (!teacher) return res.status(404).json({ error: 'Enseignant introuvable' });

  const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), teacher.id);
  if (duplicate) return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });

  const update = db.transaction(() => {
    if (password) {
      if (password.length < 8) throw new Error('PASSWORD_TOO_SHORT');
      const hash = bcrypt.hashSync(password, 12);
      db.prepare('UPDATE users SET username = ?, full_name = ?, password_hash = ? WHERE id = ?')
        .run(username.trim(), fullName.trim(), hash, teacher.id);
    } else {
      db.prepare('UPDATE users SET username = ?, full_name = ? WHERE id = ?')
        .run(username.trim(), fullName.trim(), teacher.id);
    }

    db.prepare(`
      INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
      VALUES (?, ?, 'edit', ?, ?)
    `).run(teacher.id, req.user.id, fullName.trim(), reason.trim());
  });

  try {
    update();
  } catch (err) {
    if (err.message === 'PASSWORD_TOO_SHORT') {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }
    throw err;
  }

  res.json({
    id: teacher.id,
    username: username.trim(),
    fullName: fullName.trim(),
    message: 'Enseignant modifié avec succès'
  });
});

app.delete('/api/teachers/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) {
    return res.status(400).json({ error: 'Un motif de suppression est requis' });
  }

  const teacher = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'teacher');
  if (!teacher) return res.status(404).json({ error: 'Enseignant introuvable' });

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(teacher.id);
    db.prepare(`
      INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
      VALUES (?, ?, 'remove', ?, ?)
    `).run(teacher.id, req.user.id, teacher.full_name, reason.trim());
  });
  remove();

  res.json({ message: 'Enseignant supprimé' });
});

// ─── Admin (surveillance) ───────────────────────────────────────────────────

app.get('/api/admin/stats', authMiddleware, requireRole('surveillance'), (_req, res) => {
  res.json(getAdminStats());
});

app.get('/api/admin/users', authMiddleware, requireRole('surveillance'), (req, res) => {
  res.json(listAdminUsers(req.user.id));
});

app.post('/api/admin/users', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    const id = createAdminUser(req.user.id, req.body);
    res.status(201).json({ id, message: 'Utilisateur créé avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    updateAdminUser(req.user.id, parseInt(req.params.id, 10), req.body);
    res.json({ message: 'Utilisateur modifié avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    deleteAdminUser(req.user.id, parseInt(req.params.id, 10), req.body.reason);
    res.json({ message: 'Utilisateur supprimé' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/admin/classes', authMiddleware, requireRole('surveillance'), (_req, res) => {
  res.json(listAdminClasses());
});

app.post('/api/admin/classes', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    const id = createAdminClass(req.user.id, req.body);
    res.status(201).json({ id, message: 'Classe créée avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/admin/classes/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    updateAdminClass(parseInt(req.params.id, 10), req.body);
    res.json({ message: 'Classe modifiée avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/admin/classes/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    deleteAdminClass(parseInt(req.params.id, 10), req.body);
    res.json({ message: 'Classe supprimée' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/admin/reset-points', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    const result = resetAllPoints(req.user.id, req.body.reason);
    res.json({ ...result, message: `${result.studentsUpdated} élève(s) réinitialisé(s) à ${MAX_POINTS} points` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/admin/import-students', authMiddleware, requireRole('surveillance'), uploadImport.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Fichier requis' });
  }

  try {
    const classesEleves = await parseStudentsFile(req.file.path, req.file.originalname);
    const result = applyStudentImport(req.user.id, classesEleves);
    res.json({
      ...result,
      classes: classesEleves.map((c) => ({ name: c.className, count: c.students.length })),
      message: `${result.imported} élève(s) importé(s) dans ${result.classes} classe(s)`
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Échec de l\'import' });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.delete('/api/point-logs/:id', authMiddleware, requireRole('surveillance'), (req, res) => {
  try {
    const result = deletePointLog(req.user.id, parseInt(req.params.id, 10), req.body.reason);
    res.json({ ...result, message: 'Entrée supprimée de l\'historique' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── History ────────────────────────────────────────────────────────────────

app.get('/api/students/:id/history', authMiddleware, (req, res) => {
  const history = db.prepare(`
    SELECT pl.*, u.full_name as user_name
    FROM point_logs pl
    JOIN users u ON u.id = pl.user_id
    WHERE pl.student_id = ?
    ORDER BY pl.created_at DESC
    LIMIT 50
  `).all(req.params.id);
  res.json(history);
});

app.get('/api/logs/students', authMiddleware, requireRole('surveillance'), (_req, res) => {
  const logs = db.prepare(`
    SELECT sl.*, u.full_name as user_name, c.name as class_name
    FROM student_logs sl
    JOIN users u ON u.id = sl.user_id
    JOIN classes c ON c.id = sl.class_id
    ORDER BY sl.created_at DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

app.get('/api/logs/teachers', authMiddleware, requireRole('surveillance'), (_req, res) => {
  const logs = db.prepare(`
    SELECT ul.*, u.full_name as user_name
    FROM user_logs ul
    JOIN users u ON u.id = ul.user_id
    ORDER BY ul.created_at DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

app.get('/api/logs/points', authMiddleware, (_req, res) => {
  const logs = db.prepare(`
    SELECT pl.*, u.full_name as user_name,
           s.first_name, s.last_name
    FROM point_logs pl
    JOIN users u ON u.id = pl.user_id
    JOIN students s ON s.id = pl.student_id
    ORDER BY pl.created_at DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

// ─── Fallback ───────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏫 Application École démarrée sur http://localhost:${PORT}\n`);
});
