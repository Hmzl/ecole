import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import mammoth from 'mammoth';
import db from './db.js';

const CODE_RE = /^[FE]\d{8,}$/i;
const GENRE_RE = /^(fille|gar[cç]on)$/i;
const COMPOUND_FIRST = /^(mohammed|muhammad|mohamed|abd|abdel|abou|sidi|moulay|ilyasse)$/i;
const HEADER_WORDS = new Set([
  'n.o', 'no', 'n°', 'code', 'nom', 'prénom', 'prenom', 'genre',
  'date de naissance', 'lieu naissance', 'fille', 'garçon', 'garcon',
  'académie', 'academie', 'commune', 'direction provinciale',
  'établissement', 'etablissement', 'classe', 'niveau',
  'liste des élèves', 'liste des eleves', 'année scolaire', 'annee scolaire'
]);

export function titleCaseName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isNameLike(value) {
  const s = String(value || '').trim();
  if (!s || s.length < 2 || s.length > 60) return false;
  if (/^\d+$/.test(s) || CODE_RE.test(s)) return false;
  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(s)) return false;
  if (HEADER_WORDS.has(normalizeHeader(s))) return false;
  if (GENRE_RE.test(s)) return false;
  return /^[\p{L}][\p{L}\s'.-]*$/u.test(s);
}

function splitNomPrenom(blob) {
  const tokens = String(blob || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { lastName: tokens[0], firstName: tokens[0] };
  if (tokens.length === 2) return { lastName: tokens[0], firstName: tokens[1] };
  if (COMPOUND_FIRST.test(tokens[tokens.length - 2])) {
    return {
      lastName: tokens.slice(0, -2).join(' '),
      firstName: tokens.slice(-2).join(' ')
    };
  }
  return {
    lastName: tokens.slice(0, -1).join(' '),
    firstName: tokens[tokens.length - 1]
  };
}

function findColumn(headers, aliases) {
  const normalized = headers.map((h) => normalizeHeader(h));
  for (const alias of aliases) {
    const exact = normalized.findIndex((h) => h === alias);
    if (exact !== -1) return exact;
  }
  for (const alias of aliases) {
    const soft = normalized.findIndex(
      (h) => (h.startsWith(alias) || h.endsWith(` ${alias}`) || h.endsWith(`_${alias}`))
        && !(alias === 'nom' && h.includes('prenom'))
    );
    if (soft !== -1) return soft;
  }
  return -1;
}

function groupByClass(rows) {
  const map = new Map();
  for (const row of rows) {
    const className = (row.className || 'Sans classe').trim() || 'Sans classe';
    if (!map.has(className)) map.set(className, []);
    map.get(className).push({
      firstName: titleCaseName(row.firstName),
      lastName: titleCaseName(row.lastName)
    });
  }
  return [...map.entries()].map(([className, students]) => ({ className, students }));
}

function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);
  const lastIdx = findColumn(headers, ['nom', 'lastname', 'last_name', 'name']);
  const firstIdx = findColumn(headers, ['prenom', 'firstname', 'first_name', 'prénom']);
  const classIdx = findColumn(headers, ['classe', 'class', 'classname']);

  if (lastIdx === -1 || firstIdx === -1) {
    throw Object.assign(
      new Error('Colonnes « Nom » et « Prénom » introuvables dans le fichier Excel'),
      { status: 400 }
    );
  }

  const lastKey = headers[lastIdx];
  const firstKey = headers[firstIdx];
  const classKey = classIdx >= 0 ? headers[classIdx] : null;

  return rows
    .map((row) => ({
      lastName: String(row[lastKey] || '').trim(),
      firstName: String(row[firstKey] || '').trim(),
      className: classKey ? String(row[classKey] || '').trim() : ''
    }))
    .filter((r) => isNameLike(r.lastName) && isNameLike(r.firstName));
}

async function parseWordBuffer(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return parseSchoolListText(value);
}

async function parsePdfBuffer(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return parseSchoolListText(result.text || '');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Listes scolaires (ligne: N° Code Nom Prénom Genre …) ou texte libre */
function parseSchoolListText(text) {
  const blocks = String(text)
    .split(/(?:^|\n)\s*--\s*\d+\s+of\s+\d+\s*--\s*(?:\n|$)/i)
    .map((b) => b.trim())
    .filter(Boolean);

  const pages = blocks.length ? blocks : [text];
  const collected = [];

  for (const page of pages) {
    const lines = String(page)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    let className = '';
    for (const line of lines) {
      const m = line.match(/^classe\s+([^\t|]+)/i);
      if (m) {
        className = m[1].trim().split(/\s{2,}|\t/)[0].trim();
        break;
      }
      if (normalizeHeader(line) === 'classe') continue;
    }
    // Fallback: "Classe" on its own line then value
    for (let i = 0; i < lines.length - 1; i++) {
      if (normalizeHeader(lines[i]) === 'classe' && lines[i + 1] && !HEADER_WORDS.has(normalizeHeader(lines[i + 1]))) {
        className = lines[i + 1].trim().split(/\s{2,}|\t/)[0].trim();
        break;
      }
    }

    const fromRows = extractSchoolRows(lines).map((s) => ({ ...s, className }));
    if (fromRows.length) {
      collected.push(...fromRows);
      continue;
    }

    const fromPairs = extractNamePairs(lines).map((s) => ({ ...s, className }));
    collected.push(...fromPairs);
  }

  if (collected.length) return collected;
  return parsePlainTextList(text);
}

function extractSchoolRows(lines) {
  const students = [];
  const rowRe = /^(\d+)\s+([FE]\d{8,})\s+(.+?)\s+(Fille|Gar[cç]on)\b/i;

  for (const line of lines) {
    const m = line.match(rowRe);
    if (!m) continue;
    const split = splitNomPrenom(m[3]);
    if (!split) continue;
    if (!isNameLike(split.lastName) || !isNameLike(split.firstName)) continue;
    students.push(split);
  }
  return students;
}

function extractNamePairs(lines) {
  const students = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (!isNameLike(a) || !isNameLike(b)) continue;

    const prev = lines[i - 1] || '';
    if (CODE_RE.test(prev) || /^\d+$/.test(prev)) {
      students.push({ lastName: a, firstName: b });
      i += 1;
    }
  }
  return students;
}

function parsePlainTextList(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const students = [];
  for (const line of lines) {
    const row = line.match(/^(\d+)\s+([FE]\d{8,})\s+(.+?)\s+(Fille|Gar[cç]on)\b/i);
    if (row) {
      const split = splitNomPrenom(row[3]);
      if (split) students.push({ ...split, className: '' });
      continue;
    }

    const parts = line.split(/[;,\t|]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && isNameLike(parts[0]) && isNameLike(parts[1])) {
      students.push({ lastName: parts[0], firstName: parts[1], className: parts[2] || '' });
      continue;
    }

    const spaced = line.match(/^([\p{L}][\p{L}\s'.-]{1,40}?)\s{2,}([\p{L}][\p{L}\s'.-]{1,40})$/u);
    if (spaced) {
      students.push({ lastName: spaced[1], firstName: spaced[2], className: '' });
    }
  }

  if (students.length) return students;
  return extractNamePairs(lines).map((s) => ({ ...s, className: '' }));
}

export async function parseStudentsFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  let rows;
  if (ext === '.xlsx' || ext === '.xls') {
    rows = parseExcelBuffer(buffer);
  } else if (ext === '.docx') {
    rows = await parseWordBuffer(buffer);
  } else if (ext === '.pdf') {
    rows = await parsePdfBuffer(buffer);
  } else {
    throw Object.assign(
      new Error('Format non supporté. Utilisez Excel (.xlsx), Word (.docx) ou PDF.'),
      { status: 400 }
    );
  }

  const cleaned = rows
    .map((r) => ({
      firstName: titleCaseName(r.firstName),
      lastName: titleCaseName(r.lastName),
      className: String(r.className || '').trim()
    }))
    .filter((r) => r.firstName && r.lastName);

  if (!cleaned.length) {
    throw Object.assign(
      new Error('Aucun nom / prénom détecté dans le fichier'),
      { status: 400 }
    );
  }

  return groupByClass(cleaned);
}

export function applyStudentImport(userId, classesEleves) {
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
    const logStmt = db.prepare(`
      INSERT INTO student_logs (student_id, user_id, action, student_name, class_id, reason)
      VALUES (?, ?, 'add', ?, ?, ?)
    `);

    const usedClassIds = new Set();
    let imported = 0;

    for (const { className, students } of classesEleves) {
      let classId = classByName.get(className);
      if (!classId) {
        const reusable = existingClasses.find(
          (c) => !usedClassIds.has(c.id) && !classesEleves.some((x) => x.className === c.name)
        );
        if (reusable) {
          renameClass.run(className, reusable.id);
          classId = reusable.id;
          classByName.set(className, classId);
          classByName.delete(reusable.name);
        } else {
          classId = Number(insertClass.run(className).lastInsertRowid);
          classByName.set(className, classId);
        }
      }
      usedClassIds.add(classId);

      for (const { firstName, lastName } of students) {
        const result = insertStudent.run(classId, firstName, lastName);
        logStmt.run(
          result.lastInsertRowid,
          userId,
          `${firstName} ${lastName}`,
          classId,
          `Import depuis fichier (${className})`
        );
        imported += 1;
      }
    }

    return { imported, classes: classesEleves.length };
  });

  return replace();
}
