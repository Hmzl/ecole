import XLSX from 'xlsx';
import { all, get } from './db.js';
import { MAX_POINTS, periodBounds, scalePayload, toScale20 } from './points-scale.js';

async function openingPoints(studentId, start) {
  const before = await get(`
    SELECT points_after FROM point_logs
    WHERE student_id = ? AND created_at < ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [studentId, start]);
  if (before) return Number(before.points_after);
  return MAX_POINTS;
}

function summarizeChanges(logs) {
  let gained = 0;
  let lost = 0;
  for (const log of logs) {
    const change = Number(log.points_change) || 0;
    if (change > 0) gained += change;
    else lost += change;
  }
  return { gained, lost, net: gained + lost, count: logs.length };
}

function mapLog(log) {
  const change = Number(log.points_change) || 0;
  return {
    id: log.id,
    created_at: log.created_at,
    reason: log.reason,
    user_name: log.user_name,
    change,
    change20: toScale20(change),
    before: scalePayload(log.points_before),
    after: scalePayload(log.points_after)
  };
}

export async function buildStudentReport(studentId, period, value) {
  const student = await get(`
    SELECT s.id, s.first_name, s.last_name, s.points, s.class_id, c.name as class_name
    FROM students s
    JOIN classes c ON c.id = s.class_id
    WHERE s.id = ? AND s.active = 1
  `, [studentId]);
  if (!student) {
    throw Object.assign(new Error('Élève introuvable'), { status: 404 });
  }

  const bounds = periodBounds(period, value);
  const opening = await openingPoints(student.id, bounds.start);
  const logs = await all(`
    SELECT pl.*, u.full_name as user_name
    FROM point_logs pl
    JOIN users u ON u.id = pl.user_id
    WHERE pl.student_id = ? AND pl.created_at >= ? AND pl.created_at < ?
    ORDER BY pl.created_at ASC, pl.id ASC
  `, [student.id, bounds.start, bounds.end]);

  const closing = logs.length ? Number(logs[logs.length - 1].points_after) : opening;
  const summary = summarizeChanges(logs);

  const days = [];
  if (period === 'monthly') {
    const byDay = new Map();
    for (const log of logs) {
      const day = String(log.created_at).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(log);
    }
    let running = opening;
    for (const [day, dayLogs] of byDay) {
      const startOfDay = running;
      const endOfDay = Number(dayLogs[dayLogs.length - 1].points_after);
      const daySummary = summarizeChanges(dayLogs);
      days.push({
        date: day,
        opening: scalePayload(startOfDay),
        closing: scalePayload(endOfDay),
        ...daySummary,
        net20: toScale20(daySummary.net),
        entries: dayLogs.length
      });
      running = endOfDay;
    }
  }

  return {
    period,
    range: bounds,
    student: {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      class_id: student.class_id,
      class_name: student.class_name
    },
    current: scalePayload(student.points),
    opening: scalePayload(opening),
    closing: scalePayload(closing),
    gained: scalePayload(summary.gained),
    lost: scalePayload(Math.abs(summary.lost)),
    net: scalePayload(summary.net),
    net20: toScale20(summary.net),
    entries: summary.count,
    logs: logs.map(mapLog),
    days
  };
}

export async function buildClassReport(classId, period, value) {
  const cls = await get('SELECT id, name FROM classes WHERE id = ?', [classId]);
  if (!cls) {
    throw Object.assign(new Error('Classe introuvable'), { status: 404 });
  }

  const students = await all(`
    SELECT id FROM students WHERE class_id = ? AND active = 1
    ORDER BY last_name, first_name
  `, [classId]);

  const reports = [];
  for (const student of students) {
    reports.push(await buildStudentReport(student.id, period, value));
  }

  const avgClosing = reports.length
    ? reports.reduce((sum, r) => sum + r.closing.points, 0) / reports.length
    : 0;

  return {
    period,
    range: periodBounds(period, value),
    class: cls,
    average: scalePayload(avgClosing),
    students: reports.map((r) => ({
      id: r.student.id,
      first_name: r.student.first_name,
      last_name: r.student.last_name,
      opening: r.opening,
      closing: r.closing,
      gained: r.gained,
      lost: r.lost,
      net: r.net,
      net20: r.net20,
      entries: r.entries
    }))
  };
}

function safeFilename(name) {
  return String(name || 'classe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'classe';
}

export function classReportFilename(report) {
  const period = report.period === 'monthly' ? 'mensuel' : 'quotidien';
  const stamp = report.period === 'monthly'
    ? report.range.start.slice(0, 7)
    : report.range.start.slice(0, 10);
  return `rapport-${safeFilename(report.class.name)}-${period}-${stamp}.xlsx`;
}

export function classReportToXlsx(report) {
  const periodLabel = report.period === 'monthly' ? 'Mensuel' : 'Quotidien';
  const header = [
    ['Rapport de classe'],
    ['Classe', report.class.name],
    ['Période', periodLabel],
    ['Libellé', report.range.label],
    ['Moyenne /100', report.average.points],
    ['Moyenne /20', report.average.outOf20],
    [],
    ['Nom', 'Prénom', 'Début /100', 'Début /20', 'Gains', 'Pertes', 'Variation /100', 'Variation /20', 'Fin /100', 'Fin /20', 'Modifications']
  ];
  const rows = report.students.map((s) => [
    s.last_name,
    s.first_name,
    s.opening.points,
    s.opening.outOf20,
    s.gained.points,
    s.lost.points,
    s.net.points,
    s.net20,
    s.closing.points,
    s.closing.outOf20,
    s.entries
  ]);
  const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
  ws['!cols'] = [
    { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rapport');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
