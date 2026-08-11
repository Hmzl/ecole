const API = '/api';
const MAX_POINTS = 100;
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
  el.textContent = msg;
  show(el);
}

function hideError() { hide($('#login-error')); }

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
  return new Date(iso + 'Z').toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function studentActionLabel(action) {
  if (action === 'add') return '+ Ajout';
  if (action === 'edit') return '✎ Modification';
  return '− Suppression';
}

function roleLabel(role) {
  return role === 'surveillance' ? 'Surveillance générale' : 'Enseignant';
}

function roleBadge(role) {
  return `<span class="role-badge ${role}">${roleLabel(role)}</span>`;
}

function userActionLabel(action) {
  if (action === 'add') return '+ Ajout';
  if (action === 'edit') return '✎ Modification';
  return '− Suppression';
}

// ─── Password visibility ────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-password');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  btn.textContent = visible ? '👁' : '🙈';
  btn.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
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
  hide($('#dashboard-view'));
  show($('#login-view'));
  show($('#login-form'));
  $('#username').value = '';
  $('#password').value = '';
});

async function enterDashboard() {
  hide($('#login-view'));
  show($('#dashboard-view'));

  const roleLabel = currentUser.role === 'surveillance' ? 'Administrateur' : 'Enseignant';
  $('#user-info').textContent = `${currentUser.fullName} · ${roleLabel}`;

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
}

async function selectClass(id, name, el) {
  currentClassId = id;
  $$('.class-list li').forEach(li => li.classList.remove('active'));
  el.classList.add('active');
  $('#current-class-name').textContent = name;

  const students = await api(`/classes/${id}/students`);
  $('#student-count').textContent = `${students.length} élèves`;
  renderStudents(students);
}

function renderStudents(students) {
  const grid = $('#students-grid');
  grid.innerHTML = '';

  students.forEach(student => {
    const card = document.createElement('div');
    card.className = 'student-card';
    card.innerHTML = `
      ${currentUser.role === 'surveillance' ? `
        <div class="card-actions">
          <button class="edit-btn" data-id="${student.id}" title="Modifier">✎</button>
          <button class="delete-btn" data-id="${student.id}" title="Supprimer">✕</button>
        </div>
      ` : ''}
      <div class="student-photo">${renderPhoto(student)}</div>
      <div class="student-name">${student.first_name} ${student.last_name}</div>
      <div class="student-points ${pointsClass(student.points)}">${student.points}</div>
      <div class="points-sub">points</div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions')) return;
      openPointsModal(student);
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
  show($('#points-modal'));
}

function updateModalPoints() {
  const display = currentPoints(selectedStudent) + pendingChange;
  $('#modal-current-points').textContent = display;
  $('#modal-current-points').className = `points-big ${pointsClass(display)}`;
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
    showToast('Sélectionnez une modification de points', 'error');
    return;
  }
  if (!reason) {
    showToast('Veuillez indiquer la raison du changement', 'error');
    return;
  }

  try {
    const result = await api(`/students/${selectedStudent.id}/points`, {
      method: 'POST',
      body: JSON.stringify({ change: pendingChange, reason })
    });

    selectedStudent.points = result.points;
    showToast(`Points mis à jour : ${result.points}`);
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
    ? '<li>Aucun historique</li>'
    : history.map(h => `
      <li class="history-item">
        <div class="history-item-body">
          <span class="history-change ${h.points_change > 0 ? 'positive' : 'negative'}">
            ${h.points_change > 0 ? '+' : ''}${h.points_change} pts
          </span>
          → ${h.points_after} pts
          <div class="history-meta">${h.reason} · ${h.user_name} · ${formatDate(h.created_at)}</div>
        </div>
        ${canDelete ? `<button class="history-delete-btn" data-id="${h.id}" title="Supprimer">✕</button>` : ''}
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
    `Supprimer l'entrée « ${sign}${entry.points_change} pts → ${entry.points_after} pts » (${entry.reason}) ?`;
  $('#delete-history-reason').value = '';
  show($('#delete-history-modal'));
}

$('#confirm-delete-history-btn').addEventListener('click', async () => {
  const reason = $('#delete-history-reason').value.trim();
  if (!reason) {
    showToast('Motif requis', 'error');
    return;
  }

  try {
    const result = await api(`/point-logs/${historyToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });

    showToast('Entrée supprimée');
    hide($('#delete-history-modal'));

    if (selectedStudent?.id === historyToDelete.studentId) {
      selectedStudent.points = result.points;
      updateModalPoints();
    }

    await loadHistory(historyToDelete.studentId);

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
    showToast('Élève ajouté avec 100 points');
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
    showToast('Élève modifié');
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
    `Voulez-vous supprimer ${student.first_name} ${student.last_name} ? Cette action sera enregistrée.`;
  $('#delete-reason').value = '';
  show($('#delete-modal'));
}

$('#confirm-delete-btn').addEventListener('click', async () => {
  const reason = $('#delete-reason').value.trim();
  if (!reason) {
    showToast('Motif de suppression requis', 'error');
    return;
  }

  try {
    await api(`/students/${studentToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    showToast('Élève supprimé');
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
    list.innerHTML = '<p class="empty-msg">Aucun utilisateur trouvé</p>';
    return;
  }

  list.innerHTML = filtered.map(u => `
    <div class="account-item">
      <div class="account-info">
        <div class="account-name-row">
          <strong>${u.full_name}</strong>
          ${roleBadge(u.role)}
          ${u.is_self ? '<span class="self-badge">Vous</span>' : ''}
        </div>
        <span class="account-meta">@${u.username} · créé le ${formatDate(u.created_at)}</span>
      </div>
      <div class="account-actions">
        <button class="btn btn-ghost btn-sm edit-user-btn" data-id="${u.id}">Modifier</button>
        ${u.is_self ? '' : `<button class="btn btn-ghost btn-sm delete-user-btn" data-id="${u.id}">Supprimer</button>`}
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

$('#add-user-btn').addEventListener('click', () => openUserForm(null));

function openUserForm(user) {
  userToEdit = user;
  $('#user-form').reset();
  $('#user-form-title').textContent = user ? 'Modifier un utilisateur' : 'Ajouter un utilisateur';
  $('#user-password-hint').classList.toggle('hidden', !user);
  $('#user-password').required = !user;
  $('#user-role').disabled = !!(user?.is_self);

  if (user) {
    $('#user-full-name').value = user.full_name;
    $('#user-username').value = user.username;
    $('#user-role').value = user.role;
  }

  show($('#user-form-modal'));
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    fullName: $('#user-full-name').value,
    username: $('#user-username').value,
    role: $('#user-role').value,
    reason: $('#user-reason').value
  };
  const password = $('#user-password').value;
  if (password) payload.password = password;

  try {
    if (userToEdit) {
      await api(`/admin/users/${userToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Utilisateur modifié');
    } else {
      if (!password) {
        showToast('Le mot de passe est requis', 'error');
        return;
      }
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Utilisateur ajouté');
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
    `Supprimer ${user.full_name} (@${user.username}) — ${roleLabel(user.role)} ?`;
  $('#delete-user-reason').value = '';
  show($('#delete-user-modal'));
}

$('#confirm-delete-user-btn').addEventListener('click', async () => {
  const reason = $('#delete-user-reason').value.trim();
  if (!reason) {
    showToast('Motif de suppression requis', 'error');
    return;
  }

  try {
    await api(`/admin/users/${userToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    showToast('Utilisateur supprimé');
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
      <span class="stat-label">Utilisateurs</span>
      <span class="stat-detail">${stats.users.teachers} enseignants · ${stats.users.surveillance} surveillance</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.students.active}</span>
      <span class="stat-label">Élèves actifs</span>
      <span class="stat-detail">${stats.students.inactive} inactifs</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.classes}</span>
      <span class="stat-label">Classes</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.logs.points + stats.logs.students + stats.logs.users}</span>
      <span class="stat-label">Entrées de journal</span>
      <span class="stat-detail">${stats.logs.points} pts · ${stats.logs.students} élèves · ${stats.logs.users} comptes</span>
    </div>
  `;

  const list = $('#admin-classes-list');
  if (classes.length === 0) {
    list.innerHTML = '<p class="empty-msg">Aucune classe</p>';
    return;
  }

  list.innerHTML = `
    <div class="classes-table-header">
      <span>Classe</span>
      <span>Élèves</span>
      <span>Créée le</span>
      <span>Actions</span>
    </div>
    ${classes.map(c => `
      <div class="classes-table-row">
        <strong>${c.name}</strong>
        <span>${c.student_count}</span>
        <span class="account-meta">${formatDate(c.created_at)}</span>
        <div class="account-actions">
          <button class="btn btn-ghost btn-sm edit-class-btn" data-id="${c.id}" data-name="${c.name}">Modifier</button>
          <button class="btn btn-ghost btn-sm delete-class-btn" data-id="${c.id}" data-name="${c.name}" data-count="${c.student_count}">Supprimer</button>
        </div>
      </div>
    `).join('')}
  `;

  list.querySelectorAll('.edit-class-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      classToEdit = { id: parseInt(btn.dataset.id, 10), name: btn.dataset.name };
      $('#class-form').reset();
      $('#class-form-title').textContent = 'Modifier une classe';
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
        `Supprimer la classe « ${classToDelete.name} » (${classToDelete.student_count} élève(s)) ?`;
      $('#delete-class-reason').value = '';
      show($('#delete-class-modal'));
    });
  });
}

$('#add-class-btn').addEventListener('click', () => {
  classToEdit = null;
  $('#class-form').reset();
  $('#class-form-title').textContent = 'Ajouter une classe';
  show($('#class-form-modal'));
});

$('#import-students-btn').addEventListener('click', async () => {
  const input = $('#import-students-file');
  const status = $('#import-students-status');
  const file = input.files?.[0];
  if (!file) {
    showToast('Choisissez un fichier Excel, Word ou PDF', 'error');
    return;
  }

  if (!confirm(`Importer « ${file.name} » ?\nLes élèves actifs actuels seront remplacés par la liste du fichier.`)) {
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  status.textContent = 'Import en cours…';
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
    showToast('Motif requis', 'error');
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
  const payload = { name: $('#class-name').value, reason: $('#class-reason').value };

  try {
    if (classToEdit) {
      await api(`/admin/classes/${classToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Classe modifiée');
    } else {
      await api('/admin/classes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Classe ajoutée');
    }

    hide($('#class-form-modal'));
    await loadAdminDatabase();
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

$('#confirm-delete-class-btn').addEventListener('click', async () => {
  const reason = $('#delete-class-reason').value.trim();
  if (!reason) {
    showToast('Motif requis', 'error');
    return;
  }

  try {
    await api(`/admin/classes/${classToDelete.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    showToast('Classe supprimée');
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
      ? '<p class="log-entry">Aucune modification enregistrée</p>'
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
          <button class="btn btn-ghost btn-sm delete-log-btn" data-id="${l.id}" data-student-id="${l.student_id}">Supprimer</button>
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
      ? '<p class="log-entry">Aucune action enregistrée</p>'
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
      ? '<p class="log-entry">Aucune action enregistrée</p>'
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
