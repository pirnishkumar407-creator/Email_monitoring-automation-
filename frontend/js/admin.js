// frontend/js/admin.js — Admin Portal Controller

const USER_EMAIL = sessionStorage.getItem('user_email');
const USER_ROLE = sessionStorage.getItem('user_role');
const SESSION_TOKEN = sessionStorage.getItem('session_token');

if (!USER_EMAIL || USER_ROLE !== 'admin') {
  alert('Access denied. Administrator privileges required.');
  window.location.href = '/';
}

const AUTH_HEADERS = {
  'Authorization': `Bearer ${SESSION_TOKEN}`,
  'Content-Type': 'application/json'
};

let allAdminUsers = [];
let allMailboxes = [];
let trafficChart = null;
let categoryChart = null;

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('app_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }

  document.getElementById('adminEmail').textContent = USER_EMAIL;
  document.getElementById('adminAvatar').textContent = USER_EMAIL.substring(0, 2).toUpperCase();

  loadAdminData();
  // Auto refresh every 45s
  setInterval(loadAdminData, 45000);
});


function handleAdminLogout() {
  sessionStorage.clear();
  window.location.href = '/';
}

function switchAdminTab(tab) {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tab}`);
  });

  const titles = {
    overview: ['System Overview', 'Real-time system health, users, and infrastructure oversight'],
    users: ['User Accounts', 'Manage all registered user accounts, passwords, and roles'],
    mailboxes: ['Mailbox Fleet', 'Connected IMAP & Google OAuth accounts across all users'],
    cleaner: ['Inbox Clutter Purge', 'One-click automated solution for inbox overload & junk cleanup'],
    'ai-settings': ['AI Engine & Rules', 'Global Google Gemini AI configuration & master rules']
  };

  const [title, subtitle] = titles[tab] || ['Admin Center', ''];
  document.getElementById('adminPageTitle').textContent = title;
  document.getElementById('adminPageSubtitle').textContent = subtitle;

  if (tab === 'users') loadUsersList();
  if (tab === 'mailboxes') loadMailboxFleet();
  if (tab === 'ai-settings') loadAdminSettings();
}

async function loadAdminData() {
  try {
    const res = await fetch('/api/admin/overview', { headers: AUTH_HEADERS });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/';
        return;
      }
    }
    const data = await res.json();
    if (data.success && data.overview) {
      const o = data.overview;
      document.getElementById('statUsers').textContent = o.total_users || 0;
      document.getElementById('statAdminsSub').textContent = `${o.total_admins || 0} Administrators`;
      document.getElementById('statMailboxes').textContent = o.total_mailboxes || 0;
      document.getElementById('statEmails').textContent = o.total_emails || 0;
      document.getElementById('statSentSub').textContent = `${o.total_sent || 0} Dispatched Replies`;
      document.getElementById('statDrafts').textContent = o.total_drafts || 0;

      const aiBadge = document.getElementById('aiHealthBadge');
      if (o.ai_configured) {
        aiBadge.innerHTML = `<span class="status-pulse"></span> AI Engine Online (${o.gemini_model || 'gemini-2.0-flash'})`;
        aiBadge.style.color = '#818cf8';
      } else {
        aiBadge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;"></span> API Key Missing`;
        aiBadge.style.color = '#f87171';
      }

      renderAdminCharts(o);
    }
  } catch (err) {
    console.error('Error loading admin overview:', err);
  }
}

function renderAdminCharts(overview) {
  // Traffic Chart
  const trafficCanvas = document.getElementById('adminTrafficChart');
  if (trafficCanvas) {
    const days = (overview.byDay || []).slice().reverse();
    const labels = days.map(d => d.day);
    const counts = days.map(d => d.count);

    if (trafficChart) trafficChart.destroy();

    trafficChart = new Chart(trafficCanvas, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [{
          label: 'Emails Ingested',
          data: counts.length ? counts : [0],
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#6366f1'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', precision: 0 } }
        }
      }
    });
  }

  // Category Chart
  const catCanvas = document.getElementById('adminCategoryChart');
  if (catCanvas) {
    const categories = overview.byCategory || [];
    const labels = categories.map(c => c.category);
    const counts = categories.map(c => c.count);

    if (categoryChart) categoryChart.destroy();

    categoryChart = new Chart(catCanvas, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['None'],
        datasets: [{
          data: counts.length ? counts : [1],
          backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } }
        },
        cutout: '68%'
      }
    });
  }
}

// ── User Management ─────────────────────────────────────────────────────────

async function loadUsersList() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  try {
    const res = await fetch('/api/users', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      allAdminUsers = data.users || [];
      renderUsersTable(allAdminUsers);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">Failed to load users: ${err.message}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:30px;">No user accounts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const isSelf = u.email.toLowerCase() === USER_EMAIL.toLowerCase();
    const roleBadge = u.role === 'admin' 
      ? `<span class="role-badge-admin">Admin</span>` 
      : `<span class="role-badge-user">User</span>`;

    const joinedDate = u.created_at ? new Date(u.created_at).toLocaleDateString() : '-';

    return `
      <tr>
        <td style="color:var(--text-muted); font-family:monospace;">#${u.id}</td>
        <td style="font-weight:600; color:var(--text-primary);">
          ${escapeHtml(u.email)} ${isSelf ? '<span style="font-size:0.7rem; color:var(--cyan); margin-left:4px;">(You)</span>' : ''}
        </td>
        <td>${roleBadge}</td>
        <td><span style="background:rgba(6, 182, 212, 0.1); color:var(--cyan); padding:2px 8px; border-radius:4px; font-weight:600;">${u.mailbox_count || 0}</span></td>
        <td><span style="background:rgba(99, 102, 241, 0.1); color:var(--accent); padding:2px 8px; border-radius:4px; font-weight:600;">${u.email_count || 0}</span></td>
        <td style="color:var(--text-muted); font-size:0.8rem;">${joinedDate}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:6px;">
            <button class="admin-action-btn" onclick="toggleUserRole(${u.id}, '${u.role}')" title="Change Role (${u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'})">
              ${u.role === 'admin' ? '👤 Make User' : '⭐ Make Admin'}
            </button>
            <button class="admin-action-btn" onclick="openResetPassModal(${u.id}, '${escapeHtml(u.email)}')" title="Reset Password">
              🔑 Reset Pass
            </button>
            ${!isSelf ? `
              <button class="admin-action-btn btn-danger" onclick="deleteUserAccount(${u.id}, '${escapeHtml(u.email)}')" title="Delete Account">
                🗑️
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterUsersList() {
  const query = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
  const filtered = allAdminUsers.filter(u => u.email.toLowerCase().includes(query));
  renderUsersTable(filtered);
}

function openAddUserModal() {
  document.getElementById('addUserForm').reset();
  document.getElementById('addUserModal').style.display = 'flex';
}
function closeAddUserModal() {
  document.getElementById('addUserModal').style.display = 'none';
}

async function submitAddUser(e) {
  e.preventDefault();
  const email = document.getElementById('newEmail').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ email, password, role })
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      closeAddUserModal();
      loadUsersList();
      loadAdminData();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Failed to create user: ' + err.message);
  }
}

async function toggleUserRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  if (!confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`)) return;

  try {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: 'PUT',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ role: newRole })
    });
    const data = await res.json();
    if (data.success) {
      loadUsersList();
      loadAdminData();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error changing role: ' + err.message);
  }
}

function openResetPassModal(userId, email) {
  document.getElementById('resetUserId').value = userId;
  document.getElementById('resetUserEmailText').textContent = `Set a new password for ${email}:`;
  document.getElementById('resetNewPass').value = '';
  document.getElementById('resetPassModal').style.display = 'flex';
}
function closeResetPassModal() {
  document.getElementById('resetPassModal').style.display = 'none';
}

async function submitResetPass(e) {
  e.preventDefault();
  const userId = document.getElementById('resetUserId').value;
  const password = document.getElementById('resetNewPass').value;

  try {
    const res = await fetch(`/api/users/${userId}/password`, {
      method: 'PUT',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      closeResetPassModal();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error resetting password: ' + err.message);
  }
}

async function deleteUserAccount(userId, email) {
  if (!confirm(`WARNING: Are you sure you want to permanently delete user "${email}" and all their connected mailboxes, emails, and tasks?`)) return;

  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'DELETE',
      headers: AUTH_HEADERS
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadUsersList();
      loadAdminData();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error deleting user: ' + err.message);
  }
}

// ── Mailbox Fleet ───────────────────────────────────────────────────────────

async function loadMailboxFleet() {
  const tbody = document.getElementById('mailboxesTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/mailboxes', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      allMailboxes = data.mailboxes || [];
      renderMailboxesTable(allMailboxes);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">Failed to load mailboxes: ${err.message}</td></tr>`;
  }
}

function renderMailboxesTable(mailboxes) {
  const tbody = document.getElementById('mailboxesTableBody');
  if (!tbody) return;

  if (mailboxes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:30px;">No mailboxes configured in fleet yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = mailboxes.map(m => {
    const isOAuth = m.auth_type === 'oauth';
    const typeBadge = isOAuth
      ? `<span style="background:rgba(234, 67, 53, 0.15); color:#ea4335; padding:3px 8px; border-radius:4px; font-weight:600; font-size:0.75rem;">Google OAuth</span>`
      : `<span style="background:rgba(99, 102, 241, 0.15); color:var(--accent); padding:3px 8px; border-radius:4px; font-weight:600; font-size:0.75rem;">IMAP SSL</span>`;

    return `
      <tr>
        <td style="color:var(--text-muted); font-family:monospace;">#${m.id}</td>
        <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(m.email)}</td>
        <td style="color:var(--text-secondary);">${escapeHtml(m.user_email || 'User #' + m.user_id)}</td>
        <td style="color:var(--text-muted); font-family:monospace; font-size:0.8rem;">${escapeHtml(m.imap_server || '-')}:${m.imap_port || 993}</td>
        <td>${typeBadge}</td>
        <td style="color:var(--text-muted); font-size:0.8rem;">${m.created_at ? new Date(m.created_at).toLocaleDateString() : '-'}</td>
        <td style="text-align:right;">
          <button class="admin-action-btn btn-danger" onclick="disconnectMailbox(${m.id}, '${escapeHtml(m.email)}')" title="Disconnect Mailbox">
            🗑️ Disconnect
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function disconnectMailbox(id, email) {
  if (!confirm(`Are you sure you want to disconnect mailbox "${email}" from the system?`)) return;

  try {
    const res = await fetch(`/api/admin/mailboxes/${id}`, {
      method: 'DELETE',
      headers: AUTH_HEADERS
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadMailboxFleet();
      loadAdminData();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error disconnecting mailbox: ' + err.message);
  }
}

// ── Clutter Purge (Email Overload Solution) ──────────────────────────────────

async function executeClutterPurge(e) {
  e.preventDefault();
  const purgeCategories = [];
  if (document.getElementById('cleanSpam')?.checked) purgeCategories.push('spam');
  if (document.getElementById('cleanPromo')?.checked) purgeCategories.push('promotion');
  if (document.getElementById('cleanNewsletters')?.checked) purgeCategories.push('newsletter');

  if (purgeCategories.length === 0) {
    alert('Please select at least one clutter category to purge.');
    return;
  }

  const olderThanDays = parseInt(document.getElementById('cleanAge')?.value || '0', 10);
  const timeDesc = olderThanDays > 0 ? `older than ${olderThanDays} days` : 'all time';

  if (!confirm(`Are you sure you want to PERMANENTLY purge ${purgeCategories.join(', ')} emails (${timeDesc})? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch('/api/clean-inbox', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ purgeCategories, olderThanDays })
    });
    const data = await res.json();
    if (data.success) {
      alert(`🎉 Clutter Purge Complete!\n${data.message}`);
      loadAdminData();
    } else {
      alert('Purge failed: ' + data.message);
    }
  } catch (err) {
    alert('Error during purge: ' + err.message);
  }
}

// ── AI Engine Configuration ──────────────────────────────────────────────────

async function loadAdminSettings() {
  try {
    const res = await fetch('/api/settings', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      if (s.gemini_api_key) {
        document.getElementById('adminGeminiKey').placeholder = s.gemini_api_key;
      }
      if (s.gemini_model) {
        document.getElementById('adminGeminiModel').value = s.gemini_model;
      }
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveAdminAiConfig(e) {
  e.preventDefault();
  const keyInput = document.getElementById('adminGeminiKey').value.trim();
  const model = document.getElementById('adminGeminiModel').value;

  const settings = { gemini_model: model };
  if (keyInput) settings.gemini_api_key = keyInput;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ settings })
    });
    const data = await res.json();
    if (data.success) {
      alert('AI Configuration saved successfully!');
      loadAdminData();
    } else {
      alert('Error saving settings: ' + data.message);
    }
  } catch (err) {
    alert('Error saving AI config: ' + err.message);
  }
}

async function testGeminiConnection() {
  const btn = document.getElementById('btnTestAi');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = 'Testing...';

  const keyInput = document.getElementById('adminGeminiKey')?.value.trim();
  const model = document.getElementById('adminGeminiModel')?.value;

  try {
    const res = await fetch('/api/admin/test-gemini', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ apiKey: keyInput, model })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Gemini Health Check Passed!\n\nModel: ${data.model}\nResponse Latency: ${data.latencyMs}ms\nMessage: ${data.message}`);
    } else {
      alert(`❌ Gemini Connection Test Failed:\n\n${data.message}`);
    }
  } catch (err) {
    alert('Failed to run test: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = originalHtml;
  }
}

async function triggerAdminSync() {
  const icon = document.getElementById('adminSyncIcon');
  const text = document.getElementById('adminSyncText');
  if (icon) icon.style.animation = 'spin 1s linear infinite';
  if (text) text.textContent = 'Syncing...';

  try {
    const res = await fetch('/api/run-agent', {
      method: 'POST',
      headers: AUTH_HEADERS
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadAdminData();
    } else {
      alert('Sync failed: ' + data.message);
    }
  } catch (err) {
    alert('Sync error: ' + err.message);
  } finally {
    if (icon) icon.style.animation = '';
    if (text) text.textContent = 'Sync Fleet';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
