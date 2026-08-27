import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { get, all, run, ensureSchema } from './db.js';
import { signToken, authMiddleware, requireRole } from './auth.js';
import {
  getAdminStats, listAdminUsers, listAdminClasses,
  createAdminUser, updateAdminUser, deleteAdminUser,
  createAdminClass, updateAdminClass, deleteAdminClass,
  deletePointLog, resetAllPoints, MAX_POINTS,
  assertClassAccess, assertStudentAccess
} from './admin.js';
import { parseStudentsFile, applyStudentImport } from './import-students.js';
import { buildStudentReport, buildClassReport, classReportToXlsx, classReportFilename } from './reports.js';
import { mailConfigured, sendTempPasswordEmail, generateTempPassword } from './mail.js';
import {
  ensureUploadsDir,
  getUploadsDir,
  isServerlessRuntime,
  saveUploadedFile,
  readUploadBuffer,
  cleanupTempFile
} from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

ensureUploadsDir();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

if (!isServerlessRuntime()) {
  app.use('/uploads', express.static(getUploadsDir()));
}
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
}));

app.use(async (_req, _res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (err) {
    next(err);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format d\'image non supporté'));
  }
});

const uploadImport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.docx', '.pdf'].includes(ext)) cb(null, true);
    else cb(new Error('Formats acceptés : Excel (.xlsx), Word (.docx), PDF'));
  }
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ─── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = signToken({
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    email: user.email || null,
    subject: user.subject || null
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      email: user.email || null,
      subject: user.subject || null
    }
  });
}));

app.post('/api/auth/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.username || req.body.email || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'Nom d\'utilisateur ou e-mail requis' });
  }
  if (!mailConfigured()) {
    return res.status(503).json({ error: 'L\'envoi d\'e-mail n\'est pas configuré. Contactez la surveillance.' });
  }

  const user = await get(
    'SELECT * FROM users WHERE username = ? OR lower(email) = ?',
    [identifier, identifier.toLowerCase()]
  );

  const generic = { message: 'Si un compte correspond, un e-mail a été envoyé.' };
  if (!user?.email) {
    return res.json(generic);
  }

  const tempPassword = generateTempPassword();
  await sendTempPasswordEmail(user, tempPassword);
  const hash = bcrypt.hashSync(tempPassword, 12);
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);

  res.json(generic);
}));

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ─── Classes ────────────────────────────────────────────────────────────────

app.get('/api/classes', authMiddleware, asyncHandler(async (req, res) => {
  const classes = req.user.role === 'teacher'
    ? await all(`
        SELECT c.*, COUNT(s.id) as student_count
        FROM classes c
        JOIN teacher_classes tc ON tc.class_id = c.id AND tc.user_id = ?
        LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
        GROUP BY c.id
        ORDER BY c.name
      `, [req.user.id])
    : await all(`
        SELECT c.*, COUNT(s.id) as student_count
        FROM classes c
        LEFT JOIN students s ON s.class_id = c.id AND s.active = 1
        GROUP BY c.id
        ORDER BY c.name
      `);
  res.json(classes);
}));

// ─── Students ───────────────────────────────────────────────────────────────

app.get('/api/students', authMiddleware, asyncHandler(async (req, res) => {
  const students = req.user.role === 'teacher'
    ? await all(`
        SELECT s.id, s.class_id, s.first_name, s.last_name, s.photo_path, s.points,
               c.name as class_name
        FROM students s
        JOIN classes c ON c.id = s.class_id
        JOIN teacher_classes tc ON tc.class_id = s.class_id AND tc.user_id = ?
        WHERE s.active = 1
        ORDER BY s.last_name, s.first_name
      `, [req.user.id])
    : await all(`
        SELECT s.id, s.class_id, s.first_name, s.last_name, s.photo_path, s.points,
               c.name as class_name
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.active = 1
        ORDER BY s.last_name, s.first_name
      `);
  res.json(students);
}));

app.get('/api/classes/:classId/students', authMiddleware, asyncHandler(async (req, res) => {
  await assertClassAccess(req.user, req.params.classId);
  const students = await all(`
    SELECT id, class_id, first_name, last_name, photo_path, points
    FROM students
    WHERE class_id = ? AND active = 1
    ORDER BY last_name, first_name
  `, [req.params.classId]);
  res.json(students);
}));

app.get('/api/students/:id', authMiddleware, asyncHandler(async (req, res) => {
  const student = await get(`
    SELECT id, class_id, first_name, last_name, photo_path, points
    FROM students WHERE id = ? AND active = 1
  `, [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });
  await assertStudentAccess(req.user, student);
  res.json(student);
}));

app.post('/api/students/:id/points', authMiddleware, requireRole('teacher', 'surveillance'), asyncHandler(async (req, res) => {
  const { change, reason } = req.body;
  const delta = parseInt(change, 10);

  if (isNaN(delta) || delta === 0) {
    return res.status(400).json({ error: 'Modification de points invalide' });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ error: 'Une description du changement est requise' });
  }

  const student = await get('SELECT * FROM students WHERE id = ? AND active = 1', [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });
  await assertStudentAccess(req.user, student);

  const pointsBefore = Number(student.points) || 0;
  const pointsAfter = Math.max(0, Math.min(MAX_POINTS, pointsBefore + delta));
  const appliedDelta = pointsAfter - pointsBefore;

  await run('UPDATE students SET points = ? WHERE id = ?', [pointsAfter, student.id]);
  await run(`
    INSERT INTO point_logs (student_id, user_id, points_before, points_change, points_after, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [student.id, req.user.id, pointsBefore, appliedDelta, pointsAfter, reason.trim()]);

  res.json({
    id: student.id,
    points: pointsAfter,
    change: delta,
    message: 'Points mis à jour'
  });
}));

app.post('/api/students', authMiddleware, requireRole('surveillance'), upload.single('photo'), asyncHandler(async (req, res) => {
  const { classId, firstName, lastName, reason } = req.body;

  if (!classId || !firstName?.trim() || !lastName?.trim() || !reason?.trim()) {
    return res.status(400).json({ error: 'Tous les champs sont requis, y compris le motif' });
  }

  const cls = await get('SELECT id FROM classes WHERE id = ?', [classId]);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable' });

  let photoPath = null;
  try {
    photoPath = await saveUploadedFile(req.file);
  } catch (err) {
    if (req.file && err.status === 503) {
      return res.status(503).json({ error: err.message });
    }
    throw err;
  }

  const result = await run(`
    INSERT INTO students (class_id, first_name, last_name, photo_path, points)
    VALUES (?, ?, ?, ?, 100)
  `, [classId, firstName.trim(), lastName.trim(), photoPath]);

  await run(`
    INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
    VALUES (?, ?, 'add', ?, ?, ?)
  `, [result.lastInsertRowid, req.user.id, `${firstName.trim()} ${lastName.trim()}`, classId, reason.trim()]);

  res.status(201).json({
    id: result.lastInsertRowid,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    photoPath,
    points: 100,
    message: 'Élève ajouté avec succès'
  });
}));

app.delete('/api/students/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  const student = await get('SELECT * FROM students WHERE id = ? AND active = 1', [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  await run('UPDATE students SET active = 0 WHERE id = ?', [student.id]);
  await run(`
    INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
    VALUES (?, ?, 'remove', ?, ?, ?)
  `, [student.id, req.user.id, `${student.first_name} ${student.last_name}`, student.class_id, 'Suppression']);

  res.json({ message: 'Élève supprimé' });
}));

app.post('/api/students/:id/photo', authMiddleware, requireRole('surveillance'), upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });

  const student = await get('SELECT * FROM students WHERE id = ? AND active = 1', [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  const photoPath = await saveUploadedFile(req.file);
  await run('UPDATE students SET photo_path = ? WHERE id = ?', [photoPath, student.id]);

  res.json({ photoPath });
}));

app.put('/api/students/:id', authMiddleware, requireRole('surveillance'), upload.single('photo'), asyncHandler(async (req, res) => {
  const { classId, firstName, lastName } = req.body;

  if (!classId || !firstName?.trim() || !lastName?.trim()) {
    return res.status(400).json({ error: 'Prénom, nom et classe sont requis' });
  }

  const student = await get('SELECT * FROM students WHERE id = ? AND active = 1', [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Élève introuvable' });

  const cls = await get('SELECT id FROM classes WHERE id = ?', [classId]);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable' });

  const photoPath = req.file ? await saveUploadedFile(req.file) : student.photo_path;
  const reason = 'Modification de l\'élève';

  await run(`
    UPDATE students SET class_id = ?, first_name = ?, last_name = ?, photo_path = ?
    WHERE id = ?
  `, [classId, firstName.trim(), lastName.trim(), photoPath, student.id]);

  await run(`
    INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
    VALUES (?, ?, 'edit', ?, ?, ?)
  `, [student.id, req.user.id, `${firstName.trim()} ${lastName.trim()}`, classId, reason]);

  res.json({
    id: student.id,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    classId: parseInt(classId, 10),
    photoPath,
    message: 'Élève modifié avec succès'
  });
}));

// ─── Teachers (surveillance) ────────────────────────────────────────────────

app.get('/api/teachers', authMiddleware, requireRole('surveillance'), asyncHandler(async (_req, res) => {
  const teachers = await all(`
    SELECT id, username, full_name, email, subject, created_at
    FROM users WHERE role = 'teacher'
    ORDER BY full_name
  `);
  res.json(teachers);
}));

app.post('/api/teachers', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    const id = await createAdminUser(req.user.id, { ...req.body, role: 'teacher' });
    res.status(201).json({
      id,
      username: String(req.body.username || '').trim(),
      fullName: String(req.body.fullName || '').trim(),
      message: 'Enseignant ajouté avec succès'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.put('/api/teachers/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    await updateAdminUser(req.user.id, parseInt(req.params.id, 10), { ...req.body, role: 'teacher' });
    res.json({
      id: parseInt(req.params.id, 10),
      username: String(req.body.username || '').trim(),
      fullName: String(req.body.fullName || '').trim(),
      message: 'Enseignant modifié avec succès'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.delete('/api/teachers/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  const teacher = await get('SELECT * FROM users WHERE id = ? AND role = ?', [req.params.id, 'teacher']);
  if (!teacher) return res.status(404).json({ error: 'Enseignant introuvable' });

  await run('DELETE FROM teacher_classes WHERE user_id = ?', [teacher.id]);
  await run('DELETE FROM users WHERE id = ?', [teacher.id]);
  await run(`
    INSERT INTO user_logs (target_user_id, user_id, action, target_name, reason)
    VALUES (?, ?, 'remove', ?, ?)
  `, [teacher.id, req.user.id, teacher.full_name, 'Suppression']);

  res.json({ message: 'Enseignant supprimé' });
}));

// ─── Admin (surveillance) ───────────────────────────────────────────────────

app.get('/api/admin/stats', authMiddleware, requireRole('surveillance'), asyncHandler(async (_req, res) => {
  res.json(await getAdminStats());
}));

app.get('/api/admin/users', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  res.json(await listAdminUsers(req.user.id));
}));

app.post('/api/admin/users', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    const id = await createAdminUser(req.user.id, req.body);
    res.status(201).json({ id, message: 'Utilisateur créé avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.put('/api/admin/users/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    await updateAdminUser(req.user.id, parseInt(req.params.id, 10), req.body);
    res.json({ message: 'Utilisateur modifié avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.delete('/api/admin/users/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    await deleteAdminUser(req.user.id, parseInt(req.params.id, 10));
    res.json({ message: 'Utilisateur supprimé' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get('/api/admin/classes', authMiddleware, requireRole('surveillance'), asyncHandler(async (_req, res) => {
  res.json(await listAdminClasses());
}));

app.post('/api/admin/classes', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    const id = await createAdminClass(req.user.id, req.body);
    res.status(201).json({ id, message: 'Classe créée avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.put('/api/admin/classes/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    await updateAdminClass(parseInt(req.params.id, 10), req.body);
    res.json({ message: 'Classe modifiée avec succès' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.delete('/api/admin/classes/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    await deleteAdminClass(parseInt(req.params.id, 10));
    res.json({ message: 'Classe supprimée' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post('/api/admin/reset-points', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    const result = await resetAllPoints(req.user.id, req.body.reason);
    res.json({ ...result, message: `${result.studentsUpdated} élève(s) réinitialisé(s) à ${MAX_POINTS} points` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post('/api/admin/import-students', authMiddleware, requireRole('surveillance'), uploadImport.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Fichier requis' });
  }

  try {
    const buffer = readUploadBuffer(req.file);
    const classesEleves = await parseStudentsFile(buffer, req.file.originalname);
    const result = await applyStudentImport(req.user.id, classesEleves);
    res.json({
      ...result,
      classes: classesEleves.map((c) => ({ name: c.className, count: c.students.length })),
      message: `${result.imported} élève(s) importé(s) dans ${result.classes} classe(s)`
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Échec de l\'import' });
  } finally {
    cleanupTempFile(req.file);
  }
}));

app.delete('/api/point-logs/:id', authMiddleware, requireRole('surveillance'), asyncHandler(async (req, res) => {
  try {
    const result = await deletePointLog(req.user.id, parseInt(req.params.id, 10));
    res.json({ ...result, message: 'Entrée supprimée de l\'historique' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

// ─── History ────────────────────────────────────────────────────────────────

app.get('/api/students/:id/report', authMiddleware, asyncHandler(async (req, res) => {
  const student = await get('SELECT id, class_id FROM students WHERE id = ? AND active = 1', [req.params.id]);
  await assertStudentAccess(req.user, student);
  const period = req.query.period === 'monthly' ? 'monthly' : 'daily';
  const value = period === 'monthly'
    ? (req.query.month || new Date().toISOString().slice(0, 7))
    : (req.query.date || new Date().toISOString().slice(0, 10));
  res.json(await buildStudentReport(req.params.id, period, value));
}));

app.get('/api/classes/:classId/report', authMiddleware, asyncHandler(async (req, res) => {
  await assertClassAccess(req.user, req.params.classId);
  const period = req.query.period === 'monthly' ? 'monthly' : 'daily';
  const value = period === 'monthly'
    ? (req.query.month || new Date().toISOString().slice(0, 7))
    : (req.query.date || new Date().toISOString().slice(0, 10));
  res.json(await buildClassReport(req.params.classId, period, value));
}));

app.get('/api/classes/:classId/report/export', authMiddleware, asyncHandler(async (req, res) => {
  await assertClassAccess(req.user, req.params.classId);
  const period = req.query.period === 'monthly' ? 'monthly' : 'daily';
  const value = period === 'monthly'
    ? (req.query.month || new Date().toISOString().slice(0, 7))
    : (req.query.date || new Date().toISOString().slice(0, 10));
  const report = await buildClassReport(req.params.classId, period, value);
  const buffer = classReportToXlsx(report);
  const filename = classReportFilename(report);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

app.get('/api/students/:id/history', authMiddleware, asyncHandler(async (req, res) => {
  const student = await get('SELECT id, class_id FROM students WHERE id = ? AND active = 1', [req.params.id]);
  await assertStudentAccess(req.user, student);
  const history = await all(`
    SELECT pl.*, u.full_name as user_name
    FROM point_logs pl
    JOIN users u ON u.id = pl.user_id
    WHERE pl.student_id = ?
    ORDER BY pl.created_at DESC
    LIMIT 50
  `, [req.params.id]);
  res.json(history);
}));

app.get('/api/logs/students', authMiddleware, requireRole('surveillance'), asyncHandler(async (_req, res) => {
  const logs = await all(`
    SELECT sl.*, u.full_name as user_name, c.name as class_name
    FROM student_logs sl
    JOIN users u ON u.id = sl.user_id
    JOIN classes c ON c.id = sl.class_id
    ORDER BY sl.created_at DESC
    LIMIT 100
  `);
  res.json(logs);
}));

app.get('/api/logs/teachers', authMiddleware, requireRole('surveillance'), asyncHandler(async (_req, res) => {
  const logs = await all(`
    SELECT ul.*, u.full_name as user_name
    FROM user_logs ul
    JOIN users u ON u.id = ul.user_id
    ORDER BY ul.created_at DESC
    LIMIT 100
  `);
  res.json(logs);
}));

app.get('/api/logs/points', authMiddleware, asyncHandler(async (_req, res) => {
  const logs = await all(`
    SELECT pl.*, u.full_name as user_name,
           s.first_name, s.last_name
    FROM point_logs pl
    JOIN users u ON u.id = pl.user_id
    JOIN students s ON s.id = pl.student_id
    ORDER BY pl.created_at DESC
    LIMIT 100
  `);
  res.json(logs);
}));

// ─── Fallback + errors ──────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏫 Application École démarrée sur http://localhost:${PORT}\n`);
  });
}
