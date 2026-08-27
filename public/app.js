const API = '/api';
const MAX_POINTS = 100;
const SCALE_20 = 20;
let token = localStorage.getItem('token');
let currentUser = null;
let currentClassId = null;
let selectedStudent = null;
let pendingChange = 0;
let userToEdit = null;
let userToDelete = null;
let classToEdit = null;
let classToDelete = null;
let studentToEdit = null;
let historyToDelete = null;
let adminUserFilter = 'all';
let studentReportPeriod = 'daily';
let classReportPeriod = 'daily';
let classStudents = [];
let allStudents = [];
let lastClassReport = null;
let currentClassName = '';
let deferredInstallPrompt = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function showToast(msg, type = 'success') {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  show(toast);
  setTimeout(() => hide(toast), 3000);
}

function showError(msg) {
  const el = $('#login-error');
  el.className = 'error-msg';
  el.textContent = msg;
  show(el);
}

function showLoginInfo(msg) {
  const el = $('#login-error');
  el.className = 'success-msg';
  el.textContent = msg;
  show(el);
}

function hideError() { hide($('#login-error')); }

function showLoginForm() {
  show($('#login-form'));
  show($('#forgot-link'));
  hide($('#forgot-form'));
}

function showForgotForm() {
  hide($('#login-form'));
  hide($('#forgot-link'));
  show($('#forgot-form'));
  hideError();
  $('#forgot-identifier').value = $('#username').value;
  $('#forgot-identifier').focus();
}

async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

function getInitials(first, last) {
  return `${first[0]}${last[0]}`.toUpperCase();
}

function pointsClass(pts) {
  const n = Number(pts);
  if (n >= 80) return 'high';
  if (n >= 50) return 'medium';
  return 'low';
}

function toScale20(pts) {
  return Math.round((Number(pts) || 0) * SCALE_20 / MAX_POINTS * 10) / 10;
}

function formatScale20(pts) {
  const value = toScale20(pts);
  return Number.isInteger(value) ? `${value}/20` : `${String(value).replace('.', ',')}/20`;
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonthISO() {
  return todayISO().slice(0, 7);
}

function formatSigned(n) {
  const v = Number(n) || 0;
  if (v > 0) return `+${v}`;
  if (v < 0) return `−${Math.abs(v)}`;
  return '0';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function barColor(pts) {
  const n = Number(pts) || 0;
  if (n >= 80) return '#34d399';
  if (n >= 50) return '#fbbf24';
  return '#f87171';
}

function studentScoreCircle(points, display20) {
  const value = Math.max(0, Math.min(MAX_POINTS, Number(points) || 0));
  const size = 180;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - value / MAX_POINTS);
  const color = barColor(value);
  const scale20 = display20 || formatScale20(value);
  return `
    <div class="score-circle-wrap">
      <svg class="score-circle" viewBox="0 0 ${size} ${size}" role="img" aria-label="${t('scoreOn100', { n: value })}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="#1e293b" stroke-width="${stroke}"/>
        <circle class="score-circle-fill" cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none"
          stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 ${size / 2} ${size / 2})"/>
      </svg>
      <div class="score-circle-label">
        <strong>${value}</strong>
        <span>/100</span>
        <em>${escapeHtml(scale20)}</em>
      </div>
    </div>
  `;
}

function lineChartSvg(series, title) {
  if (!series.length) return '';
  const width = 520;
  const height = 180;
  const left = 36;
  const right = 12;
  const top = 28;
  const bottom = 36;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = MAX_POINTS;
  const n = series.length;
  const xAt = (i) => left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => top + plotH - (Math.max(0, Math.min(max, v)) / max) * plotH;
  const points = series.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(' ');
  const area = `${left},${top + plotH} ${points} ${xAt(n - 1)},${top + plotH}`;
  const yTicks = [0, 50, 100];
  const step = n > 10 ? Math.ceil(n / 6) : 1;
  return `
    <svg class="report-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <text x="${left}" y="16" fill="#94a3b8" font-size="11">${escapeHtml(title)}</text>
      ${yTicks.map((t) => {
        const y = yAt(t);
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#334155" stroke-width="1"/>
          <text x="${left - 6}" y="${y + 3}" fill="#64748b" font-size="10" text-anchor="end">${t}</text>`;
      }).join('')}
      <polygon points="${area}" fill="rgba(79,140,255,0.18)"/>
      <polyline points="${points}" fill="none" stroke="#4f8cff" stroke-width="2.5" stroke-linejoin="round"/>
      ${series.map((p, i) => `<circle cx="${xAt(i)}" cy="${yAt(p.value)}" r="3.5" fill="${barColor(p.value)}"/>`).join('')}
      ${series.map((p, i) => (i % step === 0 || i === n - 1)
        ? `<text x="${xAt(i)}" y="${height - 10}" fill="#64748b" font-size="9" text-anchor="middle">${escapeHtml(p.label)}</text>`
        : '').join('')}
    </svg>
  `;
}

function classBarsHtml(students) {
  if (!students.length) return `<p class="report-empty">${t('noStudentsDisplay')}</p>`;
  return `
    <div class="class-bars">
      <div class="class-bars-title">${t('diagramTitle')}</div>
      ${students.map((s) => {
        const value = Number(s.closing.points) || 0;
        const pct = Math.max(0, Math.min(100, value));
        return `
          <div class="class-bar-row">
            <div class="class-bar-name">
              <strong>${escapeHtml(s.last_name)}</strong>
              <span>${escapeHtml(s.first_name)}</span>
            </div>
            <div class="class-bar-meter">
              <div class="class-bar-track">
                <div class="class-bar-fill ${pointsClass(value)}" style="width:${pct}%"></div>
              </div>
            </div>
            <div class="class-bar-score">
              <strong>${value}</strong>
              <span>${escapeHtml(s.closing.display20)}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function normalizeSearch(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesName(firstName, lastName, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  const hay = normalizeSearch(`${lastName} ${firstName}`);
  return q.split(/\s+/).every((part) => hay.includes(part));
}

function studentChartHtml(report) {
  const circle = studentScoreCircle(report.closing.points, report.closing.display20);
  if (report.period === 'monthly') {
    const start = report.range.start.slice(0, 10);
    const endEx = report.range.end.slice(0, 10);
    const byDay = new Map((report.days || []).map((d) => [d.date, d.closing.points]));
    const series = [];
    let running = report.opening.points;
    const addDay = (ymd) => {
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    };
    for (let day = start; day < endEx; day = addDay(day)) {
      if (byDay.has(day)) running = byDay.get(day);
      series.push({ label: day.slice(8), value: running });
    }
    return `${circle}<div class="report-chart-wrap">${lineChartSvg(series, t('dailyEvolution'))}</div>`;
  }
  if (report.logs?.length) {
    const series = [
      { label: t('start'), value: report.opening.points },
      ...report.logs.map((l, i) => ({
        label: String(i + 1),
        value: l.after.points
      }))
    ];
    return `${circle}<div class="report-chart-wrap">${lineChartSvg(series, t('pointsEvolution'))}</div>`;
  }
  return circle;
}

function currentPoints(student) {
  return Number(student?.points) || 0;
}

function renderPhoto(student) {
  if (student.photo_path) {
    return `<img src="${student.photo_path}" alt="${student.first_name}">`;
  }
  return getInitials(student.first_name, student.last_name);
}

function formatDate(iso) {
  return new Date(iso + 'Z').toLocaleString(dateLocale(), {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function studentActionLabel(action) {
  if (action === 'add') return t('actionAdd');
  if (action === 'edit') return t('actionEdit');
  return t('actionDelete');
}

function roleLabel(role) {
  return role === 'surveillance' ? t('surveillanceRole') : t('teacher');
}

function roleBadge(role) {
  return `<span class="role-badge ${role}">${roleLabel(role)}</span>`;
}

function userActionLabel(action) {
  if (action === 'add') return t('actionAdd');
  if (action === 'edit') return t('actionEdit');
  return t('actionDelete');
}

// ─── Password visibility ────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-password');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  const nowVisible = input.type === 'text';
  btn.classList.toggle('is-visible', nowVisible);
  btn.setAttribute('aria-label', nowVisible ? t('hidePassword') : t('showPassword'));
});

// ─── Auth ───────────────────────────────────────────────────────────────────

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#username').value,
        password: $('#password').value
      })
    });

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    enterDashboard();
  } catch (err) {
    showError(err.message);
  }
});

$('#logout-btn').addEventListener('click', () => {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  closeMobileMenu();
  hide($('#dashboard-view'));
  show($('#login-view'));
  showLoginForm();
  $('#username').value = '';
  $('#password').value = '';
  hideError();
});

$('#forgot-link').addEventListener('click', showForgotForm);

$('#forgot-back').addEventListener('click', () => {
  hideError();
  showLoginForm();
});

$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  try {
    await api('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ identifier: $('#forgot-identifier').value.trim() })
    });
    showLoginInfo(t('forgotSent'));
    showLoginForm();
  } catch (err) {
    showError(err.message);
  }
});

async function enterDashboard() {
  hide($('#login-view'));
  show($('#dashboard-view'));

  const roleLabelText = currentUser.role === 'surveillance' ? t('admin') : t('teacher');
  $('#user-info').textContent = `${currentUser.fullName} · ${roleLabelText}`;

  if (currentUser.role === 'surveillance') {
    show($('#surveillance-panel'));
  } else {
    hide($('#surveillance-panel'));
  }

  await loadClasses();
}

// ─── Classes & Students ─────────────────────────────────────────────────────

async function loadClasses() {
  const classes = await api('/classes');
  const list = $('#class-list');
  list.innerHTML = '';

  classes.forEach((cls, i) => {
    const li = document.createElement('li');
    li.innerHTML = `${cls.name} <span class="class-count">${cls.student_count}</span>`;
    li.dataset.id = cls.id;
    li.addEventListener('click', () => selectClass(cls.id, cls.name, li));
    list.appendChild(li);
    if (i === 0) li.click();
  });

  const classOptions = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  $('#new-class').innerHTML = classOptions;
  $('#edit-class').innerHTML = classOptions;
  if (!classes.length) $('#current-class-name').textContent = t('selectClass');
  await loadAllStudents();
}

async function loadAllStudents() {
  try {
    allStudents = await api('/students');
  } catch {
    allStudents = [];
  }
}

async function selectClass(id, name, el) {
  currentClassId = id;
  currentClassName = name;
  $$('.class-list li').forEach(li => li.classList.remove('active'));
  el.classList.add('active');
  $('#current-class-name').textContent = name;
  closeMobileMenu();

  const students = await api(`/classes/${id}/students`);
  classStudents = students;
  ['#student-search', '#home-search'].forEach((sel) => {
    const input = $(sel);
    if (input) input.value = '';
  });
  $('#student-count').textContent = t('studentsCount', { n: students.length });
  const reportBtn = $('#class-report-btn');
  if (students.length) show(reportBtn);
  else hide(reportBtn);
  renderStudents(students);
}

function renderStudents(students, options = {}) {
  const grid = $('#students-grid');
  const showClass = Boolean(options.showClass);
  grid.innerHTML = '';

  if (!students.length) {
    const query = getSearchQuery();
    grid.innerHTML = query
      ? `<p class="empty-msg">${t('noSearchResults')}</p>`
      : `<p class="empty-msg">${t('noStudentsInClass')}</p>`;
    return;
  }

  students.forEach(student => {
    const card = document.createElement('div');
    card.className = 'student-card';
    card.innerHTML = `
      ${currentUser.role === 'surveillance' ? `
        <div class="card-actions">
          <button class="edit-btn" data-id="${student.id}" title="${t('edit')}">✎</button>
          <button class="delete-btn" data-id="${student.id}" title="${t('delete')}">✕</button>
        </div>
      ` : ''}
      <div class="student-photo">${renderPhoto(student)}</div>
      <div class="student-name">
        <strong>${escapeHtml(student.last_name)}</strong>
        <span>${escapeHtml(student.first_name)}</span>
      </div>
      <div class="student-points ${pointsClass(student.points)}">${student.points}</div>
      <div class="points-sub">sur 100 · ${formatScale20(student.points)}</div>
      ${showClass && student.class_name ? `<div class="student-class">${escapeHtml(student.class_name)}</div>` : ''}
    `;

    card.addEventListener('click', async (e) => {
      if (e.target.closest('.card-actions')) return;
      await openStudentFromSearch(student);
    });

    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditStudentModal(student);
      });
    }

    const delBtn = card.querySelector('.delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteModal(student);
      });
    }

    grid.appendChild(card);
  });
}

// ─── Points Modal ───────────────────────────────────────────────────────────

function openPointsModal(student) {
  selectedStudent = student;
  pendingChange = 0;
  $('#points-reason').value = '';
  updateModalPoints();

  $('#modal-student-info').innerHTML = `
    <div class="student-photo">${renderPhoto(student)}</div>
    <div><strong>${student.first_name} ${student.last_name}</strong></div>
  `;

  loadHistory(student.id);
  studentReportPeriod = 'daily';
  $$('[data-student-report]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.studentReport === 'daily');
  });
  $('#student-report-date').value = todayISO();
  $('#student-report-month').value = currentMonthISO();
  hide($('#student-report-month'));
  show($('#student-report-date'));
  loadStudentReport();
  show($('#points-modal'));
}

function updateModalPoints() {
  const display = currentPoints(selectedStudent) + pendingChange;
  $('#modal-current-points').textContent = display;
  $('#modal-current-points').className = `points-big ${pointsClass(display)}`;
  $('#modal-points-label').textContent = t('pointsMax', { scale: formatScale20(display) });
}

$$('.btn-points').forEach(btn => {
  btn.addEventListener('click', () => {
    const delta = Number(btn.dataset.change);
    if (!Number.isFinite(delta)) return;

    const base = currentPoints(selectedStudent);
    pendingChange += delta;
    if (base + pendingChange < 0) pendingChange = -base;
    if (base + pendingChange > MAX_POINTS) pendingChange = MAX_POINTS - base;
    updateModalPoints();
  });
});

$('#apply-points-btn').addEventListener('click', async () => {
  const reason = $('#points-reason').value.trim();
  if (pendingChange === 0) {
    showToast(t('selectPointsChange'), 'error');
    return;
  }
  if (!reason) {
    showToast(t('reasonRequired'), 'error');
    return;
  }

  try {
    const result = await api(`/students/${selectedStudent.id}/points`, {
      method: 'POST',
      body: JSON.stringify({ change: pendingChange, reason })
    });

    selectedStudent.points = result.points;
    showToast(t('pointsUpdated', { n: result.points, scale: formatScale20(result.points) }));
    hide($('#points-modal'));
    await selectClass(currentClassId, $('#current-class-name').textContent,
      $(`.class-list li[data-id="${currentClassId}"]`));
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function loadHistory(studentId) {
  const history = await api(`/students/${studentId}/history`);
  const list = $('#history-list');
  const canDelete = currentUser?.role === 'surveillance';

  list.innerHTML = history.length === 0
    ? `<li>${t('noHistory')}</li>`
    : history.map(h => `
      <li class="history-item">
        <div class="history-item-body">
          <span class="history-change ${h.points_change > 0 ? 'positive' : 'negative'}">
            ${h.points_change > 0 ? '+' : ''}${h.points_change} pts
          </span>
          → ${h.points_after}/100
          <span class="history-scale20">(${formatScale20(h.points_after)})</span>
          <div class="history-meta">${h.reason} · ${h.user_name} · ${formatDate(h.created_at)}</div>
        </div>
        ${canDelete ? `<button class="history-delete-btn" data-id="${h.id}" title="${t('delete')}">✕</button>` : ''}
      </li>
    `).join('');

  list.querySelectorAll('.history-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = history.find(h => h.id === parseInt(btn.dataset.id, 10));
      openDeleteHistoryModal(entry, studentId);
    });
  });
}

function openDeleteHistoryModal(entry, studentId) {
  historyToDelete = { ...entry, studentId };
  const sign = entry.points_change > 0 ? '+' : '';
  $('#delete-history-info').textContent =
    t('deleteHistoryConfirm', { detail: `${sign}${entry.points_change} pts → ${entry.points_after} pts`, reason: entry.reason });
  $('#delete-history-reason').value = '';
  show($('#delete-history-modal'));
}

$('#confirm-delete-history-btn').addEventListener('click', async () => {
  const reason = $('#delete-history-reason').value.trim();
  if (!reason) {
    showToast(t('reasonRequiredShort'), 'error');
    return;
  }

  try {
    const result = await api(`/point-logs/${historyToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });

    showToast(t('entryDeleted'));
    hide($('#delete-history-modal'));

    if (selectedStudent?.id === historyToDelete.studentId) {
      selectedStudent.points = result.points;
      updateModalPoints();
    }

    await loadHistory(historyToDelete.studentId);
    await loadStudentReport();

    if ($('#admin-logs-panel') && !$('#admin-logs-panel').classList.contains('hidden')) {
      await loadAdminLogs('points');
    }

    if (currentClassId) {
      await selectClass(currentClassId, $('#current-class-name').textContent,
        $(`.class-list li[data-id="${currentClassId}"]`));
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── Reports ────────────────────────────────────────────────────────────────

function reportStatsHtml(report) {
  const netClass = report.net.points > 0 ? 'positive' : report.net.points < 0 ? 'negative' : '';
  return `
    <div class="report-stats">
      <div class="report-stat">
        <span class="report-stat-value">${report.opening.points}/100</span>
        <span class="report-stat-label">${t('start')} · ${report.opening.display20}</span>
      </div>
      <div class="report-stat">
        <span class="report-stat-value ${netClass}">${formatSigned(report.net.points)}</span>
        <span class="report-stat-label">${t('variation')} · ${formatSigned(report.net20)}/20</span>
      </div>
      <div class="report-stat">
        <span class="report-stat-value">${report.closing.points}/100</span>
        <span class="report-stat-label">${t('end')} · ${report.closing.display20}</span>
      </div>
      <div class="report-stat">
        <span class="report-stat-value">${report.entries}</span>
        <span class="report-stat-label">${t('changes')}</span>
      </div>
    </div>
  `;
}

async function loadStudentReport() {
  if (!selectedStudent) return;
  const box = $('#student-report');
  box.innerHTML = `<p class="report-empty">${t('loading')}</p>`;
  try {
    const query = studentReportPeriod === 'monthly'
      ? `period=monthly&month=${encodeURIComponent($('#student-report-month').value || currentMonthISO())}`
      : `period=daily&date=${encodeURIComponent($('#student-report-date').value || todayISO())}`;
    const report = await api(`/students/${selectedStudent.id}/report?${query}`);
    const logsHtml = report.logs.length
      ? `<table class="report-table">
          <thead><tr><th>${t('time')}</th><th>${t('reason')}</th><th class="num">Δ pts</th><th class="num">/100</th><th class="num">/20</th></tr></thead>
          <tbody>${report.logs.map((l) => `
            <tr>
              <td>${formatDate(l.created_at)}</td>
              <td>${escapeHtml(l.reason)} · ${escapeHtml(l.user_name)}</td>
              <td class="num ${l.change > 0 ? 'positive' : l.change < 0 ? 'negative' : ''}">${formatSigned(l.change)}</td>
              <td class="num">${l.after.points}</td>
              <td class="num">${l.after.display20}</td>
            </tr>`).join('')}
          </tbody></table>`
      : `<p class="report-empty">${t('noChangesPeriod')}</p>`;

    const daysHtml = report.days?.length
      ? `<table class="report-table">
          <thead><tr><th>${t('day')}</th><th class="num">${t('start100')}</th><th class="num">${t('delta')}</th><th class="num">${t('end100')}</th><th class="num">${t('per20')}</th></tr></thead>
          <tbody>${report.days.map((d) => `
            <tr>
              <td>${d.date}</td>
              <td class="num">${d.opening.points}</td>
              <td class="num ${d.net > 0 ? 'positive' : d.net < 0 ? 'negative' : ''}">${formatSigned(d.net)}</td>
              <td class="num">${d.closing.points}</td>
              <td class="num">${d.closing.display20}</td>
            </tr>`).join('')}
          </tbody></table>`
      : '';

    box.innerHTML = `
      <p class="report-note">${report.range.label}</p>
      ${reportStatsHtml(report)}
      ${studentChartHtml(report)}
      ${daysHtml}
      ${logsHtml}
    `;
  } catch (err) {
    box.innerHTML = `<p class="report-empty">${err.message}</p>`;
  }
}

$$('[data-student-report]').forEach((tab) => {
  tab.addEventListener('click', () => {
    studentReportPeriod = tab.dataset.studentReport;
    $$('[data-student-report]').forEach((t) => t.classList.toggle('active', t === tab));
    if (studentReportPeriod === 'monthly') {
      hide($('#student-report-date'));
      show($('#student-report-month'));
    } else {
      hide($('#student-report-month'));
      show($('#student-report-date'));
    }
    loadStudentReport();
  });
});

$('#student-report-date').addEventListener('change', loadStudentReport);
$('#student-report-month').addEventListener('change', loadStudentReport);

async function loadClassReport() {
  if (!currentClassId) return;
  const box = $('#class-report');
  box.innerHTML = `<p class="report-empty">${t('loading')}</p>`;
  try {
    const query = classReportPeriod === 'monthly'
      ? `period=monthly&month=${encodeURIComponent($('#class-report-month').value || currentMonthISO())}`
      : `period=daily&date=${encodeURIComponent($('#class-report-date').value || todayISO())}`;
    const report = await api(`/classes/${currentClassId}/report?${query}`);
    $('#class-report-subtitle').textContent = `${report.class.name} · ${report.range.label} · ${t('average')} ${report.average.points}/100 (${report.average.display20})`;

    if (!report.students.length) {
      lastClassReport = null;
      box.innerHTML = `<p class="report-empty">${t('noStudentsInClass')}</p>`;
      return;
    }

    lastClassReport = report;
    const search = $('#report-search');
    if (search) search.value = '';
    renderClassReport(report.students);
  } catch (err) {
    lastClassReport = null;
    box.innerHTML = `<p class="report-empty">${err.message}</p>`;
  }
}

function renderClassReport(students) {
  const box = $('#class-report');
  const report = lastClassReport;
  if (!report) return;

  if (!students.length) {
    box.innerHTML = `<p class="report-empty">${t('noSearchResults')}</p>`;
    return;
  }

  box.innerHTML = `
    ${classBarsHtml(students)}
    <table class="report-table">
      <thead>
        <tr>
          <th>${t('lastName')}</th>
          <th>${t('firstNameCol')}</th>
          <th class="num">${t('start100')}</th>
          <th class="num">${t('delta')}</th>
          <th class="num">${t('end100')}</th>
          <th class="num">${t('per20')}</th>
          <th class="num">${t('actions')}</th>
        </tr>
      </thead>
      <tbody>
        ${students.map((s) => `
          <tr>
            <td>${escapeHtml(s.last_name)}</td>
            <td>${escapeHtml(s.first_name)}</td>
            <td class="num">${s.opening.points}</td>
            <td class="num ${s.net.points > 0 ? 'positive' : s.net.points < 0 ? 'negative' : ''}">${formatSigned(s.net.points)}</td>
            <td class="num">${s.closing.points}</td>
            <td class="num">${s.closing.display20}</td>
            <td class="num">${s.entries}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p class="report-note">${t('scoreNote', { avg: report.average.points, avg20: report.average.display20 })}</p>
  `;
}

function getSearchQuery() {
  return ($('#home-search')?.value || $('#student-search')?.value || '').trim();
}

function syncSearchInputs(query, sourceId) {
  ['home-search', 'student-search'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.id !== sourceId && el.value !== query) el.value = query;
  });
}

async function openStudentFromSearch(student) {
  if (student.class_id != null && Number(student.class_id) !== Number(currentClassId)) {
    const li = document.querySelector(`.class-list li[data-id="${student.class_id}"]`);
    if (li) {
      await selectClass(student.class_id, student.class_name || currentClassName, li);
    }
  }
  const fresh = classStudents.find((s) => Number(s.id) === Number(student.id)) || student;
  openPointsModal(fresh);
}

function applyStudentSearch(sourceId) {
  const raw = sourceId
    ? (document.getElementById(sourceId)?.value || '')
    : ($('#home-search')?.value || $('#student-search')?.value || '');
  syncSearchInputs(raw, sourceId);
  const query = raw.trim();

  if (query && allStudents.length) {
    const filtered = allStudents.filter((s) => matchesName(s.first_name, s.last_name, query));
    $('#current-class-name').textContent = t('search');
    $('#student-count').textContent = t('studentsFound', { n: filtered.length, total: allStudents.length });
    hide($('#class-report-btn'));
    renderStudents(filtered, { showClass: true });
    return;
  }

  if (currentClassName) $('#current-class-name').textContent = currentClassName;
  const filtered = classStudents.filter((s) => matchesName(s.first_name, s.last_name, query));
  const total = classStudents.length;
  $('#student-count').textContent = query
    ? t('studentsFound', { n: filtered.length, total })
    : t('studentsCount', { n: total });
  const reportBtn = $('#class-report-btn');
  if (!query && total) show(reportBtn);
  else if (reportBtn) hide(reportBtn);
  renderStudents(filtered);
}

function applyReportSearch() {
  if (!lastClassReport) return;
  const query = $('#report-search')?.value || '';
  const filtered = lastClassReport.students.filter((s) => matchesName(s.first_name, s.last_name, query));
  renderClassReport(filtered);
}

$('#class-report-btn').addEventListener('click', () => {
  classReportPeriod = 'daily';
  $$('[data-class-report]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.classReport === 'daily');
  });
  $('#class-report-date').value = todayISO();
  $('#class-report-month').value = currentMonthISO();
  hide($('#class-report-month'));
  show($('#class-report-date'));
  show($('#class-report-modal'));
  loadClassReport();
});

$$('[data-class-report]').forEach((tab) => {
  tab.addEventListener('click', () => {
    classReportPeriod = tab.dataset.classReport;
    $$('[data-class-report]').forEach((t) => t.classList.toggle('active', t === tab));
    if (classReportPeriod === 'monthly') {
      hide($('#class-report-date'));
      show($('#class-report-month'));
    } else {
      hide($('#class-report-month'));
      show($('#class-report-date'));
    }
    loadClassReport();
  });
});

function classReportQuery() {
  return classReportPeriod === 'monthly'
    ? `period=monthly&month=${encodeURIComponent($('#class-report-month').value || currentMonthISO())}`
    : `period=daily&date=${encodeURIComponent($('#class-report-date').value || todayISO())}`;
}

function visibleClassReportStudents() {
  if (!lastClassReport) return [];
  const query = $('#report-search')?.value || '';
  return lastClassReport.students.filter((s) => matchesName(s.first_name, s.last_name, query));
}

function wrapCanvasText(ctx, text, maxWidth) {
  const raw = String(text || '').trim() || '—';
  if (ctx.measureText(raw).width <= maxWidth) return [raw];
  const words = raw.split(/\s+/);
  const lines = [];
  let line = '';
  const pushChars = (word) => {
    let chunk = '';
    for (const ch of word) {
      const test = chunk + ch;
      if (ctx.measureText(test).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk = test;
    }
    return chunk;
  };
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) line = word;
    else line = pushChars(word);
  }
  if (line) lines.push(line);
  return lines.length ? lines : [raw];
}

function drawClassDiagramCanvas(students, report) {
  ensureCanvasRoundRect();
  const cssWidth = 920;
  const pad = 36;
  const nameW = 240;
  const scoreW = 72;
  const gap = 16;
  const barX = pad + nameW + gap;
  const barW = cssWidth - barX - scoreW - pad;
  const font = isArabic()
    ? '"Tajawal", "Segoe UI", Arial, sans-serif'
    : '"DM Sans", "Segoe UI", Arial, sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  const rows = students.map((s) => {
    measure.font = `700 14px ${font}`;
    const lastLines = wrapCanvasText(measure, s.last_name, nameW);
    measure.font = `500 13px ${font}`;
    const firstLines = wrapCanvasText(measure, s.first_name, nameW);
    return {
      student: s,
      lastLines,
      firstLines,
      height: Math.max(52, 18 + (lastLines.length + firstLines.length) * 17)
    };
  });
  const headerH = 118;
  const cssHeight = headerH + rows.reduce((sum, row) => sum + row.height, 0) + 28;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.fillStyle = '#111827';
  ctx.font = `700 22px ${font}`;
  ctx.fillText(t('diagramTitle'), pad, 38);
  ctx.fillStyle = '#4b5563';
  ctx.font = `500 14px ${font}`;
  ctx.fillText(`${report.class.name} · ${report.range.label}`, pad, 64);
  ctx.fillText(t('pdfAverage', { avg: report.average.points, avg20: report.average.display20 }), pad, 86);
  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(pad, 100);
  ctx.lineTo(cssWidth - pad, 100);
  ctx.stroke();

  let y = headerH;
  rows.forEach((row) => {
    const s = row.student;
    const value = Number(s.closing.points) || 0;
    const pct = Math.max(0, Math.min(100, value)) / 100;
    let ty = y + 18;
    ctx.fillStyle = '#111827';
    ctx.font = `700 14px ${font}`;
    row.lastLines.forEach((line) => {
      ctx.fillText(line, pad, ty);
      ty += 17;
    });
    ctx.fillStyle = '#6b7280';
    ctx.font = `500 13px ${font}`;
    row.firstLines.forEach((line) => {
      ctx.fillText(line, pad, ty);
      ty += 17;
    });

    const barY = y + Math.max(14, (row.height - 16) / 2);
    ctx.fillStyle = '#eef2f7';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, 16, 8);
    ctx.fill();
    if (pct > 0) {
      ctx.fillStyle = barColor(value);
      ctx.beginPath();
      ctx.roundRect(barX, barY, Math.max(6, barW * pct), 16, 8);
      ctx.fill();
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#111827';
    ctx.font = `700 15px ${font}`;
    ctx.fillText(String(value), cssWidth - pad, y + row.height / 2 - 2);
    ctx.fillStyle = '#6b7280';
    ctx.font = `500 11px ${font}`;
    ctx.fillText(s.closing.display20 || formatScale20(value), cssWidth - pad, y + row.height / 2 + 14);
    ctx.textAlign = 'left';
    y += row.height;
  });

  return canvas;
}

function canvasToJpegBytes(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Création de l’image PDF impossible'));
        return;
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
    }, 'image/jpeg', quality);
  });
}

function buildJpegPdf(pages) {
  const enc = new TextEncoder();
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 28;
  const parts = [];
  const offsets = [0];
  const add = (data) => {
    parts.push(typeof data === 'string' ? enc.encode(data) : data);
  };
  const sizeSoFar = () => parts.reduce((n, p) => n + p.length, 0);
  const addObj = (text) => {
    offsets.push(sizeSoFar());
    add(text);
  };

  add('%PDF-1.4\n');
  const n = pages.length;
  const pageObjIds = pages.map((_, i) => 3 + i * 3);
  const contentObjIds = pages.map((_, i) => 4 + i * 3);
  const imageObjIds = pages.map((_, i) => 5 + i * 3);

  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  addObj(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] >>\nendobj\n`);

  pages.forEach((page, i) => {
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const fit = Math.min(maxW / page.width, maxH / page.height);
    const drawW = page.width * fit;
    const drawH = page.height * fit;
    const x = margin;
    const y = pageH - margin - drawH;
    const stream = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im${i} Do\nQ\n`;
    addObj(`${pageObjIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${i} ${imageObjIds[i]} 0 R >> >> /Contents ${contentObjIds[i]} 0 R >>\nendobj\n`);
    addObj(`${contentObjIds[i]} 0 obj\n<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`);
    offsets.push(sizeSoFar());
    add(`${imageObjIds[i]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`);
    add(page.data);
    add('\nendstream\nendobj\n');
  });

  const xrefOffset = sizeSoFar();
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  add(xref);
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(sizeSoFar());
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return new Blob([out], { type: 'application/pdf' });
}

function classDiagramFilename(report) {
  const cls = String(report?.class?.name || 'classe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'classe';
  const when = String(report?.range?.label || todayISO()).replace(/[^\dA-Za-z]+/g, '-');
  return `diagramme-points-${cls}-${when}.pdf`;
}

function ensureCanvasRoundRect() {
  const proto = CanvasRenderingContext2D.prototype;
  if (typeof proto.roundRect === 'function') return;
  proto.roundRect = function (x, y, w, h, r) {
    const rad = Math.min(Number(r) || 0, w / 2, h / 2);
    this.moveTo(x + rad, y);
    this.arcTo(x + w, y, x + w, y + h, rad);
    this.arcTo(x + w, y + h, x, y + h, rad);
    this.arcTo(x, y + h, x, y, rad);
    this.arcTo(x, y, x + w, y, rad);
    this.closePath();
    return this;
  };
}

async function createClassDiagramPdf(students, report) {
  ensureCanvasRoundRect();
  const canvas = drawClassDiagramCanvas(students, report);
  const pagePxH = Math.round(canvas.width * (297 / 210));
  const slices = [];
  for (let y = 0; y < canvas.height; y += pagePxH) {
    const h = Math.min(pagePxH, canvas.height - y);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    slices.push({
      width: slice.width,
      height: slice.height,
      data: await canvasToJpegBytes(slice)
    });
  }
  return buildJpegPdf(slices);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function printPdfBlob(blob) {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  };
}

async function exportClassDiagramPdf(mode) {
  const report = lastClassReport;
  const students = visibleClassReportStudents();
  if (!report || !students.length) {
    showToast(t('noDiagram'), 'error');
    return;
  }
  try {
    const blob = await createClassDiagramPdf(students, report);
    if (mode === 'print') {
      printPdfBlob(blob);
      showToast(t('printingPdf'));
      return;
    }
    downloadBlob(blob, classDiagramFilename(report));
    showToast(t('pdfDownloaded'));
  } catch (err) {
    showToast(err.message || t('pdfFailed'), 'error');
  }
}

$('#class-report-date').addEventListener('change', loadClassReport);
$('#class-report-month').addEventListener('change', loadClassReport);
$('#student-search')?.addEventListener('input', () => applyStudentSearch('student-search'));
$('#home-search')?.addEventListener('input', () => applyStudentSearch('home-search'));
$('#report-search')?.addEventListener('input', applyReportSearch);
$('#download-class-report-btn').addEventListener('click', () => exportClassDiagramPdf('download'));
$('#print-class-report-btn').addEventListener('click', () => exportClassDiagramPdf('print'));

// ─── Add Student ────────────────────────────────────────────────────────────

$('#add-student-btn').addEventListener('click', () => {
  $('#add-student-form').reset();
  show($('#add-student-modal'));
});

$('#add-student-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append('classId', $('#new-class').value);
  formData.append('firstName', $('#new-first-name').value);
  formData.append('lastName', $('#new-last-name').value);
  formData.append('reason', $('#add-reason').value);
  const photo = $('#new-photo').files[0];
  if (photo) formData.append('photo', photo);

  try {
    await api('/students', { method: 'POST', body: formData });
    showToast(t('studentAdded'));
    hide($('#add-student-modal'));
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── Edit Student ───────────────────────────────────────────────────────────

function openEditStudentModal(student) {
  studentToEdit = student;
  $('#edit-first-name').value = student.first_name;
  $('#edit-last-name').value = student.last_name;
  $('#edit-class').value = student.class_id;
  $('#edit-photo').value = '';
  show($('#edit-student-modal'));
}

$('#edit-student-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append('classId', $('#edit-class').value);
  formData.append('firstName', $('#edit-first-name').value);
  formData.append('lastName', $('#edit-last-name').value);
  const photo = $('#edit-photo').files[0];
  if (photo) formData.append('photo', photo);

  try {
    await api(`/students/${studentToEdit.id}`, { method: 'PUT', body: formData });
    showToast(t('studentEdited'));
    hide($('#edit-student-modal'));
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── Delete Student ─────────────────────────────────────────────────────────

let studentToDelete = null;

function openDeleteModal(student) {
  studentToDelete = student;
  $('#delete-student-name').textContent =
    t('deleteStudentConfirm', { first: student.first_name, last: student.last_name });
  $('#delete-reason').value = '';
  show($('#delete-modal'));
}

$('#confirm-delete-btn').addEventListener('click', async () => {
  const reason = $('#delete-reason').value.trim();
  if (!reason) {
    showToast(t('deleteReasonRequired'), 'error');
    return;
  }

  try {
    await api(`/students/${studentToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    showToast(t('studentDeleted'));
    hide($('#delete-modal'));
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── Admin Dashboard ────────────────────────────────────────────────────────

async function openAdminDashboard(tab = 'users') {
  show($('#admin-dashboard'));
  switchAdminTab(tab);
}

function switchAdminTab(tab) {
  $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.adminTab === tab));
  hide($('#admin-users-panel'));
  hide($('#admin-database-panel'));
  hide($('#admin-logs-panel'));

  if (tab === 'users') {
    show($('#admin-users-panel'));
    loadAdminUsers();
  } else if (tab === 'database') {
    show($('#admin-database-panel'));
    loadAdminDatabase();
  } else {
    show($('#admin-logs-panel'));
    loadAdminLogs('points');
  }
}

$('#admin-dashboard-btn').addEventListener('click', () => openAdminDashboard('users'));

$('#view-logs-btn').addEventListener('click', () => openAdminDashboard('logs'));

$$('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAdminTab(tab.dataset.adminTab));
});

$$('[data-user-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    adminUserFilter = btn.dataset.userFilter;
    $$('[data-user-filter]').forEach(b => b.classList.toggle('active', b === btn));
    loadAdminUsers();
  });
});

async function loadAdminUsers() {
  const users = await api('/admin/users');
  const filtered = adminUserFilter === 'all'
    ? users
    : users.filter(u => u.role === adminUserFilter);

  const list = $('#admin-users-list');
  if (filtered.length === 0) {
    list.innerHTML = `<p class="empty-msg">${t('noUsers')}</p>`;
    return;
  }

  list.innerHTML = filtered.map(u => `
    <div class="account-item">
      <div class="account-info">
        <div class="account-name-row">
          <strong>${escapeHtml(u.full_name)}</strong>
          ${roleBadge(u.role)}
          ${u.is_self ? `<span class="self-badge">${t('you')}</span>` : ''}
        </div>
        <span class="account-meta">@${escapeHtml(u.username)}${u.email ? ` · ${escapeHtml(u.email)}` : ''}${u.role === 'teacher' && u.subject ? ` · ${escapeHtml(u.subject)}` : ''}${u.role === 'teacher' && u.class_names?.length ? ` · ${escapeHtml(u.class_names.join(', '))}` : ''} · ${t('createdOn')} ${formatDate(u.created_at)}</span>
      </div>
      <div class="account-actions">
        <button class="btn btn-ghost btn-sm edit-user-btn" data-id="${u.id}">${t('edit')}</button>
        ${u.is_self ? '' : `<button class="btn btn-ghost btn-sm delete-user-btn" data-id="${u.id}">${t('delete')}</button>`}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = users.find(u => u.id === parseInt(btn.dataset.id, 10));
      openUserForm(user);
    });
  });

  list.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = users.find(u => u.id === parseInt(btn.dataset.id, 10));
      openDeleteUserModal(user);
    });
  });
}

function syncTeacherFields() {
  const isTeacher = $('#user-role').value === 'teacher';
  $('#user-subject-group').classList.toggle('hidden', !isTeacher);
  $('#user-classes-group').classList.toggle('hidden', !isTeacher);
  $('#user-subject').required = isTeacher;
  if (!isTeacher) {
    $('#user-subject').value = '';
    $$('#user-classes-list input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  }
}

async function fillUserClassCheckboxes(selectedIds = []) {
  const selected = new Set((selectedIds || []).map((id) => Number(id)));
  const box = $('#user-classes-list');
  try {
    const classes = await api('/admin/classes');
    if (!classes.length) {
      box.innerHTML = `<p class="hint">${t('noClasses')}</p>`;
      return;
    }
    box.innerHTML = classes.map((c) => `
      <label>
        <input type="checkbox" name="user-class" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''}>
        ${escapeHtml(c.name)}
      </label>
    `).join('');
  } catch {
    box.innerHTML = `<p class="hint">${t('noClasses')}</p>`;
  }
}

function selectedTeacherClassIds() {
  return [...$$('#user-classes-list input[name="user-class"]:checked')].map((cb) => parseInt(cb.value, 10));
}

$('#add-user-btn').addEventListener('click', () => openUserForm(null));

async function openUserForm(user) {
  userToEdit = user;
  $('#user-form').reset();
  $('#user-form-title').textContent = user ? t('editUserTitle') : t('addUserTitle');
  $('#user-password-hint').classList.toggle('hidden', !user);
  $('#user-password').required = !user;
  $('#user-role').disabled = !!(user?.is_self);

  if (user) {
    $('#user-full-name').value = user.full_name;
    $('#user-username').value = user.username;
    $('#user-role').value = user.role;
    $('#user-email').value = user.email || '';
    $('#user-subject').value = user.subject || '';
  }

  await fillUserClassCheckboxes(user?.role === 'teacher' ? user.class_ids : []);
  syncTeacherFields();
  show($('#user-form-modal'));
}

$('#user-role').addEventListener('change', syncTeacherFields);

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const role = $('#user-role').value;
  const email = $('#user-email').value.trim();
  const subject = $('#user-subject').value.trim();

  if (!email) {
    showToast(t('emailRequired'), 'error');
    return;
  }
  if (role === 'teacher' && !subject) {
    showToast(t('subjectRequired'), 'error');
    return;
  }
  const classIds = selectedTeacherClassIds();
  if (role === 'teacher' && !classIds.length) {
    showToast(t('classesRequired'), 'error');
    return;
  }

  const payload = {
    fullName: $('#user-full-name').value,
    username: $('#user-username').value,
    role,
    email,
    subject: role === 'teacher' ? subject : '',
    classIds: role === 'teacher' ? classIds : []
  };
  const password = $('#user-password').value;
  if (password) payload.password = password;

  try {
    if (userToEdit) {
      await api(`/admin/users/${userToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast(t('userEdited'));
    } else {
      if (!password) {
        showToast(t('passwordRequired'), 'error');
        return;
      }
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast(t('userAdded'));
    }

    hide($('#user-form-modal'));
    await loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function openDeleteUserModal(user) {
  userToDelete = user;
  $('#delete-user-name').textContent =
    t('deleteUserConfirm', { name: user.full_name, username: user.username });
  $('#delete-user-reason').value = '';
  show($('#delete-user-modal'));
}

$('#confirm-delete-user-btn').addEventListener('click', async () => {
  const reason = $('#delete-user-reason').value.trim();
  if (!reason) {
    showToast(t('deleteReasonRequired'), 'error');
    return;
  }

  try {
    await api(`/admin/users/${userToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    showToast(t('userDeleted'));
    hide($('#delete-user-modal'));
    await loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function loadAdminDatabase() {
  const [stats, classes] = await Promise.all([
    api('/admin/stats'),
    api('/admin/classes')
  ]);

  $('#admin-stats').innerHTML = `
    <div class="stat-card">
      <span class="stat-value">${stats.users.total}</span>
      <span class="stat-label">${t('statUsers')}</span>
      <span class="stat-detail">${t('statUsersDetail', { teachers: stats.users.teachers, surv: stats.users.surveillance })}</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.students.active}</span>
      <span class="stat-label">${t('statStudents')}</span>
      <span class="stat-detail">${t('statStudentsDetail', { n: stats.students.inactive })}</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.classes}</span>
      <span class="stat-label">${t('statClasses')}</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.logs.points + stats.logs.students + stats.logs.users}</span>
      <span class="stat-label">${t('statLogs')}</span>
      <span class="stat-detail">${t('statLogsDetail', { pts: stats.logs.points, students: stats.logs.students, accounts: stats.logs.users })}</span>
    </div>
  `;

  const list = $('#admin-classes-list');
  if (classes.length === 0) {
    list.innerHTML = `<p class="empty-msg">${t('noClasses')}</p>`;
    return;
  }

  list.innerHTML = `
    <div class="classes-table-header">
      <span>${t('classLabel')}</span>
      <span>${t('logsStudents')}</span>
      <span>${t('createdAt')}</span>
      <span>${t('actions')}</span>
    </div>
    ${classes.map(c => `
      <div class="classes-table-row">
        <strong>${c.name}</strong>
        <span>${c.student_count}</span>
        <span class="account-meta">${formatDate(c.created_at)}</span>
        <div class="account-actions">
          <button class="btn btn-ghost btn-sm edit-class-btn" data-id="${c.id}" data-name="${c.name}">${t('edit')}</button>
          <button class="btn btn-ghost btn-sm delete-class-btn" data-id="${c.id}" data-name="${c.name}" data-count="${c.student_count}">${t('delete')}</button>
        </div>
      </div>
    `).join('')}
  `;

  list.querySelectorAll('.edit-class-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      classToEdit = { id: parseInt(btn.dataset.id, 10), name: btn.dataset.name };
      $('#class-form').reset();
      $('#class-form-title').textContent = t('editClassTitle');
      $('#class-name').value = classToEdit.name;
      show($('#class-form-modal'));
    });
  });

  list.querySelectorAll('.delete-class-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      classToDelete = {
        id: parseInt(btn.dataset.id, 10),
        name: btn.dataset.name,
        student_count: parseInt(btn.dataset.count, 10)
      };
      $('#delete-class-name').textContent =
        t('deleteClassConfirm', { name: classToDelete.name, n: classToDelete.student_count });
      show($('#delete-class-modal'));
    });
  });
}

$('#add-class-btn').addEventListener('click', () => {
  classToEdit = null;
  $('#class-form').reset();
  $('#class-form-title').textContent = t('addClassTitle');
  show($('#class-form-modal'));
});

$('#import-students-btn').addEventListener('click', async () => {
  const input = $('#import-students-file');
  const status = $('#import-students-status');
  const file = input.files?.[0];
  if (!file) {
    showToast(t('chooseImportFile'), 'error');
    return;
  }

  if (!confirm(t('importConfirm', { name: file.name }))) {
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  status.textContent = t('importInProgress');
  show(status);

  try {
    const result = await api('/admin/import-students', { method: 'POST', body: formData });
    status.textContent = result.message;
    showToast(result.message);
    input.value = '';
    await loadAdminDatabase();
    await loadClasses();
  } catch (err) {
    status.textContent = err.message;
    showToast(err.message, 'error');
  }
});

$('#reset-points-btn').addEventListener('click', () => {
  $('#reset-points-reason').value = '';
  show($('#reset-points-modal'));
});

$('#confirm-reset-points-btn').addEventListener('click', async () => {
  const reason = $('#reset-points-reason').value.trim();
  if (!reason) {
    showToast(t('reasonRequiredShort'), 'error');
    return;
  }

  try {
    const result = await api('/admin/reset-points', {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    showToast(result.message);
    hide($('#reset-points-modal'));
    await loadAdminDatabase();
    if (currentClassId) {
      await selectClass(currentClassId, $('#current-class-name').textContent,
        $(`.class-list li[data-id="${currentClassId}"]`));
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
});

$('#class-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { name: $('#class-name').value };

  try {
    if (classToEdit) {
      await api(`/admin/classes/${classToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast(t('classEdited'));
    } else {
      await api('/admin/classes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast(t('classAdded'));
    }

    hide($('#class-form-modal'));
    await loadAdminDatabase();
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

$('#confirm-delete-class-btn').addEventListener('click', async () => {
  try {
    await api(`/admin/classes/${classToDelete.id}`, {
      method: 'DELETE'
    });
    showToast(t('classDeleted'));
    hide($('#delete-class-modal'));
    await loadAdminDatabase();
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function loadAdminLogs(type) {
  $$('.admin-log-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.adminLog === type));
  hide($('#admin-logs-points'));
  hide($('#admin-logs-students'));
  hide($('#admin-logs-users'));

  if (type === 'points') {
    show($('#admin-logs-points'));
    const logs = await api('/logs/points');
    $('#admin-logs-points').innerHTML = logs.length === 0
      ? `<p class="log-entry">${t('noPointsLogs')}</p>`
      : logs.map(l => `
        <div class="log-entry log-entry-actions">
          <div>
            <strong>${l.first_name} ${l.last_name}</strong>:
            <span class="history-change ${l.points_change > 0 ? 'positive' : 'negative'}">
              ${l.points_change > 0 ? '+' : ''}${l.points_change}
            </span>
            (${l.points_before} → ${l.points_after})
            <div class="history-meta">${l.reason} · ${l.user_name} · ${formatDate(l.created_at)}</div>
          </div>
          <button class="btn btn-ghost btn-sm delete-log-btn" data-id="${l.id}" data-student-id="${l.student_id}">${t('delete')}</button>
        </div>
      `).join('');

    $('#admin-logs-points').querySelectorAll('.delete-log-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const log = logs.find(l => l.id === parseInt(btn.dataset.id, 10));
        openDeleteHistoryModal(log, parseInt(btn.dataset.studentId, 10));
      });
    });
  } else if (type === 'students') {
    show($('#admin-logs-students'));
    const logs = await api('/logs/students');
    $('#admin-logs-students').innerHTML = logs.length === 0
      ? `<p class="log-entry">${t('noActions')}</p>`
      : logs.map(l => `
        <div class="log-entry">
          <span class="log-action ${l.action}">${studentActionLabel(l.action)}</span>:
          <strong>${l.student_name}</strong> (${l.class_name})
          <div class="history-meta">${l.reason} · ${l.user_name} · ${formatDate(l.created_at)}</div>
        </div>
      `).join('');
  } else {
    show($('#admin-logs-users'));
    const logs = await api('/logs/teachers');
    $('#admin-logs-users').innerHTML = logs.length === 0
      ? `<p class="log-entry">${t('noActions')}</p>`
      : logs.map(l => `
        <div class="log-entry">
          <span class="log-action ${l.action}">${userActionLabel(l.action)}</span>:
          <strong>${l.target_name}</strong>
          <div class="history-meta">${l.reason} · ${l.user_name} · ${formatDate(l.created_at)}</div>
        </div>
      `).join('');
  }
}

$$('[data-admin-log]').forEach(tab => {
  tab.addEventListener('click', () => loadAdminLogs(tab.dataset.adminLog));
});

// ─── Modal close ────────────────────────────────────────────────────────────

$$('.modal-close, .modal-backdrop').forEach(el => {
  el.addEventListener('click', () => {
    el.closest('.modal') && hide(el.closest('.modal'));
  });
});

function closeMobileMenu() {
  document.body.classList.remove('menu-open');
  const toggle = $('#menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  const backdrop = $('#sidebar-backdrop');
  if (backdrop) hide(backdrop);
}

function openMobileMenu() {
  document.body.classList.add('menu-open');
  const toggle = $('#menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  const backdrop = $('#sidebar-backdrop');
  if (backdrop) show(backdrop);
}

$('#menu-toggle')?.addEventListener('click', () => {
  if (document.body.classList.contains('menu-open')) closeMobileMenu();
  else openMobileMenu();
});

$('#sidebar-backdrop')?.addEventListener('click', closeMobileMenu);

$('#admin-dashboard-btn')?.addEventListener('click', closeMobileMenu);
$('#add-student-btn')?.addEventListener('click', closeMobileMenu);
$('#view-logs-btn')?.addEventListener('click', closeMobileMenu);

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeMobileMenu();
});

// ─── Installer l'application (écran d'accueil) ─────────────────────────────

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function updateInstallButtons() {
  $$('.install-app-btn').forEach((btn) => {
    if (isStandaloneApp()) hide(btn);
    else show(btn);
  });
}

async function handleInstallApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButtons();
    return;
  }
  if (isIosDevice()) {
    show($('#install-help-modal'));
    return;
  }
  show($('#install-help-modal'));
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallButtons();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButtons();
  showToast(t('appInstalled'));
});

$$('.install-app-btn').forEach((btn) => {
  btn.addEventListener('click', handleInstallApp);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

updateInstallButtons();

window.addEventListener('app-language-change', () => {
  if (!currentUser) return;
  const roleText = currentUser.role === 'surveillance' ? t('admin') : t('teacher');
  $('#user-info').textContent = `${currentUser.fullName} · ${roleText}`;
  if (currentClassId) applyStudentSearch();
  else $('#current-class-name').textContent = t('selectClass');
  if (selectedStudent && !$('#points-modal').classList.contains('hidden')) {
    updateModalPoints();
    loadHistory(selectedStudent.id);
    loadStudentReport();
  }
  if (!$('#class-report-modal').classList.contains('hidden')) loadClassReport();
  if (!$('#user-form-modal').classList.contains('hidden')) {
    $('#user-form-title').textContent = userToEdit ? t('editUserTitle') : t('addUserTitle');
  }
  if (!$('#class-form-modal').classList.contains('hidden')) {
    $('#class-form-title').textContent = classToEdit ? t('editClassTitle') : t('addClassTitle');
  }
  if (!$('#admin-dashboard').classList.contains('hidden')) {
    loadAdminUsers();
    if (!$('#admin-database-panel').classList.contains('hidden')) loadAdminDatabase();
    const activeLog = document.querySelector('.admin-log-tabs .tab.active');
    if (activeLog && !$('#admin-logs-panel').classList.contains('hidden')) {
      loadAdminLogs(activeLog.dataset.adminLog);
    }
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────

(async () => {
  if (token) {
    try {
      const data = await api('/auth/me');
      currentUser = data.user;
      enterDashboard();
    } catch {
      localStorage.removeItem('token');
      token = null;
    }
  }
})();
