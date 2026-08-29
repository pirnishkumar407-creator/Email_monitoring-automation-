// frontend/js/app.js — Dashboard Controller

// ── Session ─────────────────────────────────────────────────────────────────
const USER_EMAIL = sessionStorage.getItem('user_email');
const USER_ROLE = sessionStorage.getItem('user_role');
const USER_ID = sessionStorage.getItem('user_id');

if (!USER_EMAIL) { window.location.href = '/'; }

const SESSION_TOKEN = sessionStorage.getItem('session_token');
const AUTH_HEADERS = { 'Authorization': `Bearer ${SESSION_TOKEN}` };

// ── State ───────────────────────────────────────────────────────────────────
let allEmails = [];
let allImapAccounts = [];
let currentFilter = 'all'; // category filter
let currentPriorityFilter = 'all'; // 'all', 'High', 'Medium', 'Low', 'grouped'
let currentSearchQuery = '';
let currentModalEmail = null;
let editingEmailId = null;
let countdownIntervals = [];

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set user info in sidebar
  document.getElementById('userName').textContent = USER_EMAIL;
  document.getElementById('userRole').textContent = USER_ROLE === 'admin' ? 'Administrator' : 'User';
  document.getElementById('userAvatar').textContent = USER_EMAIL.substring(0, 2).toUpperCase();

  // Show admin-only elements
  if (USER_ROLE === 'admin') {
    document.getElementById('navUsers').style.display = 'flex';
    document.getElementById('adminSettings').style.display = 'block';
  }

  // Load initial data
  refreshData();

  // Auto-refresh every 30 seconds
  setInterval(refreshData, 30000);
});

// ── Tab Navigation ──────────────────────────────────────────────────────────
function switchTab(tab) {
  // Update nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Update content sections
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tab}`);
  });

  // Update header
  const titles = {
    dashboard: ['Dashboard', 'Overview of your email automation'],
    monitoring: ['Universal Inbox', 'Email inbox with segregated High, Medium, and Low priority views'],
    drafts: ['AI Drafts', 'Review, edit, and manage AI-generated replies'],
    tasks: ['Sent Logs', 'Logs of outbound automated and approved email responses'],
    composer: ['AI Composer', 'Draft and dispatch outbound emails using Gemini AI'],
    analytics: ['Analytics', 'Visual insights into your email activity'],
    users: ['User Management', 'Manage registered users (Admin only)'],
    settings: ['Settings', 'Configure your email and AI settings'],
  };
  const [title, subtitle] = titles[tab] || ['Dashboard', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = subtitle;

  // Load tab-specific data
  if (tab === 'analytics') loadAnalytics();
  if (tab === 'users') loadUsers();
  if (tab === 'settings') loadSettings();
  if (tab === 'tasks') renderSentLogs();
}

let isOnboardingActive = false;

async function checkOnboarding() {
  try {
    const accRes = await fetch('/api/imap-accounts', { headers: AUTH_HEADERS });
    const accData = await accRes.json();
    if (accData.success) {
      allImapAccounts = accData.accounts;
      if (allImapAccounts.length === 0) {
        document.getElementById('onboardingOverlay').style.display = 'flex';
        isOnboardingActive = true;
        return true;
      } else {
        document.getElementById('onboardingOverlay').style.display = 'none';
        isOnboardingActive = false;
        return false;
      }
    }
  } catch (e) {
    console.error('Onboarding check error:', e);
  }
  return false;
}

async function refreshData() {
  const onboarding = await checkOnboarding();
  if (onboarding) return;

  await Promise.all([loadStats(), loadEmails()]);
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      document.getElementById('statTotal').textContent = data.stats.total;
      document.getElementById('statUrgent').textContent = data.stats.urgent;
      document.getElementById('statDrafted').textContent = data.stats.drafted;
      document.getElementById('statSent').textContent = data.stats.sent;
    }
  } catch (e) { console.error('Stats error:', e); }
}

async function loadEmails() {
  try {
    // Fetch IMAP accounts list to display the target mailbox address
    const accRes = await fetch('/api/imap-accounts', { headers: AUTH_HEADERS });
    const accData = await accRes.json();
    if (accData.success) {
      allImapAccounts = accData.accounts;
    }

    const res = await fetch('/api/emails', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      allEmails = data.emails;
      renderMonitoring();
      renderDraftsList();
      renderSentLogs();
    }
  } catch (e) { console.error('Emails error:', e); }
}

// ── Monitoring Controller (Priority & Category Separation) ─────────────────
function filterPriority(priority) {
  currentPriorityFilter = priority;
  
  // Update priority buttons active state
  document.querySelectorAll('.priority-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === priority);
  });
  
  // Update stat cards active class
  const cardMap = { 'High': 'cardHigh', 'Medium': 'cardMed', 'Low': 'cardLow', 'all': 'cardAll' };
  document.querySelectorAll('.mon-stat-card').forEach(card => card.classList.remove('active'));
  if (cardMap[priority]) {
    const cardEl = document.getElementById(cardMap[priority]);
    if (cardEl) cardEl.classList.add('active');
  }
  
  renderMonitoring();
}

function filterEmails(category) {
  currentFilter = category;
  document.querySelectorAll('.category-filter-group .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === category);
  });
  renderMonitoring();
}

function onMonitoringSearch(val) {
  currentSearchQuery = (val || '').toLowerCase().trim();
  const clearBtn = document.getElementById('monSearchClear');
  if (clearBtn) clearBtn.style.display = currentSearchQuery ? 'inline-block' : 'none';
  renderMonitoring();
}

function clearMonitoringSearch() {
  const input = document.getElementById('monSearchInput');
  if (input) input.value = '';
  currentSearchQuery = '';
  const clearBtn = document.getElementById('monSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderMonitoring();
}

function renderMonitoringTable() {
  renderMonitoring();
}

function renderMonitoring() {
  // 1. Calculate Priority Counts across all loaded emails
  const highEmailsAll = allEmails.filter(e => (e.priority || '').toLowerCase() === 'high');
  const medEmailsAll = allEmails.filter(e => (e.priority || '').toLowerCase() === 'medium');
  const lowEmailsAll = allEmails.filter(e => (e.priority || '').toLowerCase() === 'low');

  // Update counters
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('monCountHigh', highEmailsAll.length);
  setTxt('monCountMed', medEmailsAll.length);
  setTxt('monCountLow', lowEmailsAll.length);
  setTxt('monCountAll', allEmails.length);

  setTxt('monPillHigh', highEmailsAll.length);
  setTxt('monPillMed', medEmailsAll.length);
  setTxt('monPillLow', lowEmailsAll.length);
  setTxt('monPillAll', allEmails.length);

  const tableView = document.getElementById('monitoringTableView');
  const groupedView = document.getElementById('monitoringGroupedView');

  // Helper filter function
  const filterList = (list) => {
    return list.filter(e => {
      // Category filter
      if (currentFilter !== 'all' && (e.category || '').toLowerCase() !== currentFilter.toLowerCase()) {
        return false;
      }
      // Search filter
      if (currentSearchQuery) {
        const text = `${e.sender || ''} ${e.subject || ''} ${e.summary || ''} ${e.intent || ''} ${e.body || ''}`.toLowerCase();
        if (!text.includes(currentSearchQuery)) return false;
      }
      return true;
    });
  };

  // 2. Render Table View filtered by Priority, Category, and Search
  let emailsToRender = allEmails;
  if (currentPriorityFilter !== 'all') {
    emailsToRender = emailsToRender.filter(e => (e.priority || '').toLowerCase() === currentPriorityFilter.toLowerCase());
  }
  emailsToRender = filterList(emailsToRender);

  const tbody = document.getElementById('monitoringBody');
  if (!tbody) return;

  if (!emailsToRender.length) {
    const filterDesc = currentPriorityFilter === 'all' 
      ? (currentFilter === 'all' ? 'emails' : `${currentFilter} emails`)
      : `${currentPriorityFilter} priority emails`;
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No ${filterDesc} found.</td></tr>`;
    return;
  }

  tbody.innerHTML = emailsToRender.map(e => {
    const pLower = (e.priority || 'medium').toLowerCase();
    const cLower = (e.category || 'important').toLowerCase();
    const acc = allImapAccounts.find(a => a.id === e.imap_account_id);
    const accBadgeHtml = acc ? `<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; font-size:0.65rem; padding:2px 6px; margin-left:6px; vertical-align:middle; display:inline-block;">To: ${escHtml(acc.email)}</span>` : '';
    return `
      <tr>
        <td><strong>${escHtml(e.sender)}</strong></td>
        <td style="max-width:240px; font-weight:500;">
          ${escHtml(e.subject)}
          ${e.requires_approval ? '<span class="badge badge-high" style="font-size:0.65rem; padding:2px 8px; margin-left:6px; vertical-align:middle; display:inline-block;">⚠️ Permission Required</span>' : ''}
          ${accBadgeHtml}
        </td>
        <td><span class="badge badge-${pLower}">${escHtml(e.priority || 'Medium')}</span></td>
        <td><span class="pill pill-${cLower}">${escHtml(e.category || 'important')}</span></td>
        <td><span class="intent-tag">${escHtml(e.intent || '—')}</span></td>
        <td style="max-width:260px;">${escHtml(e.summary || '—')}</td>
        <td style="text-align:center;">
          <button class="btn-card-view" onclick="openMonitoringEmailModal(${e.id})">👁️ View</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Email Details Modal ─────────────────────────────────────────────────────
function openMonitoringEmailModal(id) {
  const email = allEmails.find(e => e.id === id);
  if (!email) return;
  currentModalEmail = email;

  document.getElementById('monModalSender').textContent = email.sender || 'Unknown Sender';
  document.getElementById('monModalSubject').textContent = email.subject || 'No Subject';
  document.getElementById('monModalDate').textContent = email.received_at ? new Date(email.received_at).toLocaleString() : 'N/A';
  
  const pLower = (email.priority || 'medium').toLowerCase();
  const pBadge = document.getElementById('monModalPriorityBadge');
  if (pBadge) {
    pBadge.className = `badge badge-${pLower}`;
    pBadge.textContent = `${email.priority || 'Medium'} Priority`;
  }

  const cLower = (email.category || 'important').toLowerCase();
  const cPill = document.getElementById('monModalCategoryPill');
  if (cPill) {
    cPill.className = `pill pill-${cLower}`;
    cPill.textContent = email.category || 'Important';
  }

  document.getElementById('monModalIntent').textContent = email.intent || 'General inquiry';
  document.getElementById('monModalSummary').textContent = email.summary || 'No summary available.';
  document.getElementById('monModalBody').textContent = email.body || 'Empty body.';

  const approvalAlert = document.getElementById('monModalApprovalAlert');
  if (approvalAlert) {
    approvalAlert.style.display = email.requires_approval ? 'block' : 'none';
  }

  // Draft Reply
  const draftBox = document.getElementById('monModalDraftReplyBox');
  const draftPre = document.getElementById('monModalDraftReply');
  if (draftBox && draftPre) {
    if (email.draft_reply) {
      draftBox.style.display = 'block';
      draftPre.textContent = email.draft_reply;
    } else {
      draftBox.style.display = 'none';
      draftPre.textContent = '';
    }
  }

  // Action items
  const aiBox = document.getElementById('monModalActionItemsBox');
  const aiList = document.getElementById('monModalActionItemsList');
  if (email.action_items && Array.isArray(email.action_items) && email.action_items.length) {
    aiBox.style.display = 'block';
    aiList.innerHTML = email.action_items.map(item => `<li>${escHtml(item)}</li>`).join('');
  } else {
    aiBox.style.display = 'none';
    aiList.innerHTML = '';
  }

  // Bind reply & task buttons
  const repBtn = document.getElementById('monModalReplyBtn');
  if (repBtn) repBtn.onclick = onModalReplyClick;
  const taskBtn = document.getElementById('monModalTaskBtn');
  if (taskBtn) taskBtn.onclick = onModalCreateTaskClick;

  document.getElementById('monitoringEmailModal').style.display = 'flex';
}

function closeMonitoringEmailModal() {
  document.getElementById('monitoringEmailModal').style.display = 'none';
  currentModalEmail = null;
}

function onModalReplyClick() {
  if (!currentModalEmail) return;
  const email = currentModalEmail;
  closeMonitoringEmailModal();
  switchTab('composer');
  setTimeout(() => {
    const recEl = document.getElementById('compRecipient');
    const subEl = document.getElementById('compSubject');
    const refEl = document.getElementById('compRefEmail');
    if (recEl) recEl.value = email.sender || '';
    if (subEl) subEl.value = (email.subject || '').startsWith('Re:') ? email.subject : `Re: ${email.subject || ''}`;
    if (refEl) refEl.value = `From: ${email.sender}\nSubject: ${email.subject}\n\n${email.body || ''}`;
  }, 100);
}

function onModalCreateTaskClick() {
  if (!currentModalEmail) return;
  const email = currentModalEmail;
  closeMonitoringEmailModal();
  openCreateTaskModal();
  setTimeout(() => {
    const titleEl = document.getElementById('taskTitle');
    const descEl = document.getElementById('taskDescription');
    const prioEl = document.getElementById('taskPriority');
    if (titleEl) titleEl.value = `Follow up: ${email.subject || 'Email inquiry'}`;
    if (descEl) descEl.value = `From: ${email.sender}\nSummary: ${email.summary || ''}\nIntent: ${email.intent || ''}`;
    if (prioEl) prioEl.value = email.priority || 'Medium';
  }, 100);
}

// ── Agent Synchronization ───────────────────────────────────────────────────
async function triggerAgentSync() {
  const btn = document.getElementById('btnRunSync');
  const syncText = document.getElementById('syncText');
  const syncIcon = document.getElementById('syncIcon');
  if (!btn) return;

  btn.disabled = true;
  btn.style.opacity = '0.7';
  if (syncText) syncText.textContent = 'Syncing...';
  if (syncIcon) {
    syncIcon.style.animation = 'spin 1.5s linear infinite';
  }

  try {
    const res = await fetch('/api/run-agent', {
      method: 'POST',
      headers: AUTH_HEADERS
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      await refreshData();
    } else {
      alert('Sync Failed: ' + data.message);
    }
  } catch (e) {
    console.error('Agent sync error:', e);
    alert('Error running agent sync: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    if (syncText) syncText.textContent = 'Run Agent';
    if (syncIcon) {
      syncIcon.style.animation = 'none';
    }
  }
}

// ── Drafts List ─────────────────────────────────────────────────────────────
function renderDraftsList() {
  const container = document.getElementById('draftsList');
  const pendingDrafts = allEmails.filter(e => e.status === 'Pending' && e.draft_reply);
  const processedDrafts = allEmails.filter(e => e.status !== 'Pending' && e.draft_reply);

  // Clear old countdown intervals
  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals = [];

  let html = '';

  // 1. Pending Review Section
  html += `
    <div class="drafts-section-header">
      <h3>⏳ Pending Review (${pendingDrafts.length})</h3>
    </div>
  `;
  
  if (!pendingDrafts.length) {
    html += `
      <div class="empty-state-card" style="margin-bottom: 24px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <p>No pending drafts. Run the agent to generate AI draft replies.</p>
      </div>
    `;
  } else {
    html += `<div class="drafts-grid" style="margin-bottom: 28px;">` + pendingDrafts.map(e => {
      const acc = allImapAccounts.find(a => a.id === e.imap_account_id);
      const accText = acc ? `To: ${escHtml(acc.email)}` : '';
      return `
      <div class="draft-card" id="draft-${e.id}">
        <div class="draft-header">
          <div>
            <div class="draft-sender">↩ Reply to: ${escHtml(e.sender)} ${accText ? `<span style="opacity:0.6; font-size:0.8rem; margin-left:6px;">(${accText})</span>` : ''}</div>
            <div class="draft-subject">${escHtml(e.subject)}</div>
          </div>
          <div class="${e.requires_approval ? 'draft-timer expired' : 'draft-timer'}" id="timer-${e.id}" data-send-at="${e.send_at || ''}">
            ${e.requires_approval ? '⚠️ Permission Required' : '⏱ Calculating...'}
          </div>
        </div>
        ${e.summary ? `<div class="draft-summary">📋 <strong>Summary:</strong> ${escHtml(e.summary)}</div>` : ''}
        <div class="draft-body">${escHtml(e.draft_reply)}</div>
        <div class="draft-actions">
          <button class="btn-approve" onclick="approveDraft(${e.id})">✅ Approve & Send</button>
          <button class="btn-edit" onclick="openEditModal(${e.id})">✏️ Edit</button>
          <button class="btn-reject" onclick="rejectDraft(${e.id})">❌ Reject</button>
        </div>
      </div>
      `;
    }).join('') + `</div>`;
  }

  // 2. Drafts History Section
  html += `
    <div class="drafts-section-header">
      <h3>📜 Drafts History (${processedDrafts.length})</h3>
    </div>
  `;

  if (!processedDrafts.length) {
    html += `
      <div class="empty-state-card">
        <p>No processed drafts in history yet.</p>
      </div>
    `;
  } else {
    html += `<div class="drafts-grid">` + processedDrafts.map(e => {
      let statusBadge = '';
      if (e.status === 'Sent' || e.status === 'Approved') {
        statusBadge = '<span class="badge badge-low">Sent</span>';
      } else if (e.status === 'Auto-Sent') {
        statusBadge = '<span class="badge badge-medium">Auto-Sent</span>';
      } else if (e.status === 'Rejected') {
        statusBadge = '<span class="badge badge-high">Rejected</span>';
      } else {
        statusBadge = `<span class="badge">${escHtml(e.status)}</span>`;
      }

      const acc = allImapAccounts.find(a => a.id === e.imap_account_id);
      const accText = acc ? `To: ${escHtml(acc.email)}` : '';

      return `
        <div class="draft-card processed-draft" id="draft-${e.id}" style="opacity: 0.85; border-left: 3px solid var(--border);">
          <div class="draft-header">
            <div>
              <div class="draft-sender">↩ Reply to: ${escHtml(e.sender)} ${accText ? `<span style="opacity:0.6; font-size:0.8rem; margin-left:6px;">(${accText})</span>` : ''}</div>
              <div class="draft-subject">${escHtml(e.subject)}</div>
            </div>
            <div class="draft-status">
              ${statusBadge}
            </div>
          </div>
          ${e.summary ? `<div class="draft-summary">📋 <strong>Summary:</strong> ${escHtml(e.summary)}</div>` : ''}
          <div class="draft-body" style="background: rgba(255,255,255,0.015); border-color: rgba(255,255,255,0.03); max-height: 120px; overflow-y: auto;">${escHtml(e.draft_reply)}</div>
        </div>
      `;
    }).join('') + `</div>`;
  }

  container.innerHTML = html;

  // Start countdown timers
  pendingDrafts.forEach(e => {
    if (e.send_at && !e.requires_approval) {
      const timerId = setInterval(() => updateTimer(e.id, e.send_at, timerId), 1000);
      countdownIntervals.push(timerId);
      updateTimer(e.id, e.send_at, timerId);
    }
  });
}

function updateTimer(emailId, sendAt, intervalId) {
  const el = document.getElementById(`timer-${emailId}`);
  if (!el) { clearInterval(intervalId); return; }

  const diff = new Date(sendAt) - new Date();
  if (diff <= 0) {
    el.textContent = '⏱ Auto-sending...';
    el.classList.add('expired');
    clearInterval(intervalId);
    return;
  }

  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  el.textContent = `⏱ Auto-sends in ${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Draft Actions ───────────────────────────────────────────────────────────
async function approveDraft(id) {
  if (!confirm('Approve and send this draft reply?')) return;
  try {
    const res = await fetch(`/api/emails/${id}/approve`, { method: 'POST', headers: AUTH_HEADERS });
    const data = await res.json();
    alert(data.message);
    refreshData();
  } catch (e) { alert('Error: ' + e.message); }
}

async function rejectDraft(id) {
  if (!confirm('Reject this draft? It will not be sent.')) return;
  try {
    const res = await fetch(`/api/emails/${id}/reject`, { method: 'POST', headers: AUTH_HEADERS });
    const data = await res.json();
    alert(data.message);
    refreshData();
  } catch (e) { alert('Error: ' + e.message); }
}

function openEditModal(id) {
  const email = allEmails.find(e => e.id === id);
  if (!email) return;
  editingEmailId = id;
  document.getElementById('editDraftText').value = email.draft_reply;
  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  editingEmailId = null;
}

async function submitEditDraft() {
  if (!editingEmailId) return;
  const draft_reply = document.getElementById('editDraftText').value;
  try {
    const res = await fetch(`/api/emails/${editingEmailId}/edit`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft_reply })
    });
    const data = await res.json();
    alert(data.message);
    closeEditModal();
    refreshData();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Analytics ───────────────────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (!data.success) return;

    const a = data.analytics;

    // By Day (line chart)
    const dayLabels = a.byDay.map(d => d.day.substring(5)).reverse(); // MM-DD
    const dayValues = a.byDay.map(d => d.count).reverse();
    drawLineChart('chartByDay', dayLabels, dayValues);

    // By Category (donut)
    const catLabels = a.byCategory.map(c => c.category || 'Unknown');
    const catValues = a.byCategory.map(c => c.count);
    const catColors = catLabels.map(c => {
      const map = { important: '#6366f1', spam: '#ef4444', newsletter: '#06b6d4', promotion: '#f59e0b' };
      return map[c] || '#8b5cf6';
    });
    drawDonutChart('chartByCategory', catLabels, catValues, catColors);

    // By Priority (bar)
    const priLabels = a.byPriority.map(p => p.priority);
    const priValues = a.byPriority.map(p => p.count);
    const priColors = priLabels.map(p => {
      const map = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };
      return map[p] || '#6366f1';
    });
    drawBarChart('chartByPriority', priLabels, priValues, priColors);

    // Response rate gauge
    const pct = a.responseRate || 0;
    document.getElementById('gaugeValue').textContent = pct + '%';
    document.querySelector('.gauge-circle').style.setProperty('--gauge-pct', pct + '%');

  } catch (e) { console.error('Analytics error:', e); }
}

// ── Users Management (Admin) ────────────────────────────────────────────────
async function loadUsers() {
  if (USER_ROLE !== 'admin') return;
  try {
    const res = await fetch('/api/users', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td><strong>${escHtml(u.email)}</strong></td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-high' : 'badge-medium'}">${u.role}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>
          ${u.role === 'admin'
            ? '<button class="btn-delete" disabled>Protected</button>'
            : `<button class="btn-delete" onclick="deleteUser(${u.id})">Delete</button>`
          }
        </td>
      </tr>
    `).join('');
  } catch (e) { console.error('Users error:', e); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user permanently?')) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: AUTH_HEADERS });
    const data = await res.json();
    alert(data.message);
    loadUsers();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Settings ────────────────────────────────────────────────────────────────
let allUsersList = [];

async function loadSettings() {
  loadImapAccounts();

  if (USER_ROLE === 'admin') {
    try {
      const res = await fetch('/api/settings', { headers: AUTH_HEADERS });
      const data = await res.json();
      if (data.success) {
        document.getElementById('setGeminiKey').value = data.settings.gemini_api_key || '';
        document.getElementById('setGeminiModel').value = data.settings.gemini_model || '';
      }
      
      const usersRes = await fetch('/api/users', { headers: AUTH_HEADERS });
      const usersData = await usersRes.json();
      if (usersData.success) {
        allUsersList = usersData.users;
        const select = document.getElementById('accountAdminUserSelect');
        if (select) {
          select.innerHTML = allUsersList.map(u => `<option value="${u.id}">${u.email} (${u.role})</option>`).join('');
        }
      }
    } catch (e) { console.error('Admin settings error:', e); }
  }
}

async function saveSettings(e) {
  e.preventDefault();
  if (USER_ROLE !== 'admin') return;

  const settings = {
    gemini_api_key: document.getElementById('setGeminiKey').value,
    gemini_model: document.getElementById('setGeminiModel').value,
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    });
    const data = await res.json();
    alert(data.message);
  } catch (e) { alert('Error saving settings: ' + e.message); }
}

async function loadImapAccounts() {
  const container = document.getElementById('imapAccountsList');
  if (!container) return;

  try {
    const res = await fetch('/api/imap-accounts', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Error loading accounts.</div>`;
      return;
    }

    const accounts = data.accounts;

    // Enforce 2-mailbox limit for non-admin users in settings view
    const connectBtn = document.querySelector('[onclick="openAddAccountModal()"]');
    if (connectBtn) {
      if (USER_ROLE !== 'admin' && accounts.length >= 2) {
        connectBtn.disabled = true;
        connectBtn.style.opacity = '0.5';
        connectBtn.title = 'Standard users can only connect up to 2 email accounts.';
      } else {
        connectBtn.disabled = false;
        connectBtn.style.opacity = '1';
        connectBtn.title = '';
      }
    }
    if (accounts.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1; padding: 24px; text-align: center; background: rgba(255,255,255,0.01); border-radius: var(--radius-md); border: 1px dashed var(--border);">
          <div style="font-size: 2rem; margin-bottom: 8px;">📬</div>
          <h5 style="margin:0 0 6px 0; font-size:1rem; color:var(--text-primary);">No Connected Mailboxes</h5>
          <p style="margin:0 0 12px 0; font-size:0.85rem; color:var(--text-muted);">Configure an email mailbox to start fetching and analyzing emails with AI.</p>
          <button type="button" class="btn-primary" onclick="openAddAccountModal()" style="padding:6px 12px; font-size:0.8rem;">+ Connect First Mailbox</button>
        </div>
      `;
      return;
    }

    container.innerHTML = accounts.map(acc => {
      return `
        <div class="stat-card" style="display:flex; flex-direction:column; justify-content:space-between; align-items:stretch; padding:16px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--bg-secondary); min-height: 140px; box-shadow: var(--shadow-sm);">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge badge-medium" style="font-family:monospace; font-size:0.8rem; word-break:break-all; max-width:70%;">${escHtml(acc.email)}</span>
              <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">IMAP</span>
            </div>
            <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px; text-align:left;">
              <strong>Server:</strong> ${escHtml(acc.imap_server)}:${acc.imap_port}
            </div>
            <div style="font-size:0.85rem; color:var(--text-secondary); text-align:left;">
              <strong>Username:</strong> ${escHtml(acc.imap_user)}
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px; border-top:1px solid rgba(255,255,255,0.05); padding-top:12px;">
            <button type="button" class="action-btn-view" onclick="openEditAccountModal(${acc.id}, '${escHtml(acc.email)}', '${escHtml(acc.imap_server)}', ${acc.imap_port}, '${escHtml(acc.imap_user)}')" style="padding:4px 8px; font-size:0.75rem; background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; cursor:pointer;">✏️ Edit</button>
            <button type="button" class="action-btn-reject" onclick="deleteAccount(${acc.id})" style="padding:4px 8px; font-size:0.75rem; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); color:var(--red); border-radius:4px; cursor:pointer;">🗑️ Disconnect</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Error: ${e.message}</div>`;
  }
}

function openAddAccountModal() {
  document.getElementById('accountForm').reset();
  document.getElementById('accountEditId').value = '';
  document.getElementById('accountEmail').disabled = false;
  document.getElementById('accountModalTitle').textContent = 'Connect Email Account';
  document.getElementById('accountSubmitBtn').textContent = 'Connect Mailbox';
  
  if (USER_ROLE === 'admin') {
    document.getElementById('accountAdminUserSelectGroup').style.display = 'block';
  } else {
    document.getElementById('accountAdminUserSelectGroup').style.display = 'none';
  }

  document.getElementById('accountModal').style.display = 'flex';
}

function openEditAccountModal(id, email, server, port, user) {
  document.getElementById('accountForm').reset();
  document.getElementById('accountEditId').value = id;
  document.getElementById('accountEmail').value = email;
  document.getElementById('accountEmail').disabled = true;
  document.getElementById('accountImapServer').value = server;
  document.getElementById('accountImapPort').value = port;
  document.getElementById('accountImapUser').value = user;
  document.getElementById('accountImapPassword').placeholder = '•••••••• (Enter new to change)';
  
  document.getElementById('accountModalTitle').textContent = 'Edit Connection Settings';
  document.getElementById('accountSubmitBtn').textContent = 'Save Changes';
  document.getElementById('accountAdminUserSelectGroup').style.display = 'none';
  
  document.getElementById('accountModal').style.display = 'flex';
}

function closeAccountModal() {
  document.getElementById('accountModal').style.display = 'none';
}

function autoSuggestImapServer() {
  const email = document.getElementById('accountEmail').value.trim();
  if (!email || !email.includes('@')) return;

  const domain = email.split('@')[1].toLowerCase();
  let server = 'imap.' + domain;
  let port = '993';

  if (domain === 'gmail.com') {
    server = 'imap.gmail.com';
  } else if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com' || domain === 'office365.com') {
    server = 'outlook.office365.com';
  } else if (domain === 'yahoo.com') {
    server = 'imap.mail.yahoo.com';
  }

  document.getElementById('accountImapServer').value = server;
  document.getElementById('accountImapPort').value = port;
  document.getElementById('accountImapUser').value = email;
}

async function submitAccountForm(e) {
  e.preventDefault();
  const editId = document.getElementById('accountEditId').value;
  const email = document.getElementById('accountEmail').value.trim();
  const imap_server = document.getElementById('accountImapServer').value.trim();
  const imap_port = document.getElementById('accountImapPort').value.trim();
  const imap_user = document.getElementById('accountImapUser').value.trim();
  const imap_password = document.getElementById('accountImapPassword').value;
  const userId = document.getElementById('accountAdminUserSelect')?.value || null;

  if (!editId && !imap_password) {
    alert('Password is required when connecting a new mailbox.');
    return;
  }

  const payload = { email, imap_server, imap_port, imap_user, imap_password };
  if (USER_ROLE === 'admin' && userId) {
    payload.userId = userId;
  }

  try {
    if (editId) {
      const res = await fetch(`/api/imap-accounts/${editId}`, {
        method: 'PUT',
        headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeAccountModal();
        loadImapAccounts();
        refreshData();
      } else {
        alert('Error: ' + data.message);
      }
    } else {
      const res = await fetch('/api/imap-accounts', {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeAccountModal();
        loadImapAccounts();
        refreshData();
      } else {
        alert('Error: ' + data.message);
      }
    }
  } catch (err) {
    alert('Error connecting mailbox: ' + err.message);
  }
}

async function deleteAccount(id) {
  if (!confirm('Are you sure you want to disconnect this mailbox? Ingested emails will not be deleted, but no new emails will be fetched from this address.')) return;

  try {
    const res = await fetch(`/api/imap-accounts/${id}`, {
      method: 'DELETE',
      headers: AUTH_HEADERS
    });
    const data = await res.json();
    if (data.success) {
      loadImapAccounts();
      refreshData();
    } else {
      alert('Error disconnecting account: ' + data.message);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── Export ───────────────────────────────────────────────────────────────────
function exportData() {
  const link = document.createElement('a');
  link.href = `/api/export`;
  // We need to add auth header — use fetch + blob instead
  fetch('/api/export', { headers: AUTH_HEADERS })
    .then(res => res.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `email_export_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => alert('Export failed: ' + err.message));
}

// ── Logout ──────────────────────────────────────────────────────────────────
function handleLogout() {
  sessionStorage.clear();
  window.location.href = '/';
}

// ── Utility ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Tasks & Kanban Board Workspace ──────────────────────────────────────────
let allTasks = [];
let currentTaskFilter = 'all';

async function loadTasks() {
  try {
    const res = await fetch('/api/tasks', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      allTasks = data.tasks;
      renderKanbanBoard();
    }
  } catch (e) { console.error('Tasks loading error:', e); }
}

function filterTasks(status) {
  currentTaskFilter = status;
  document.querySelectorAll('[data-task-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.taskFilter === status || (status === 'all' && btn.dataset.taskFilter === 'all'));
  });
  renderKanbanBoard();
}

function renderKanbanBoard() {
  const todoBody = document.getElementById('body-todo');
  const inProgressBody = document.getElementById('body-in-progress');
  const completedBody = document.getElementById('body-completed');

  if (!todoBody || !inProgressBody || !completedBody) return;

  todoBody.innerHTML = '';
  inProgressBody.innerHTML = '';
  completedBody.innerHTML = '';

  let todoCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;

  // Toggle column visibility based on filter selection
  document.getElementById('col-todo').style.display = (currentTaskFilter === 'all' || currentTaskFilter === 'To Do') ? 'flex' : 'none';
  document.getElementById('col-in-progress').style.display = (currentTaskFilter === 'all' || currentTaskFilter === 'In Progress') ? 'flex' : 'none';
  document.getElementById('col-completed').style.display = (currentTaskFilter === 'all' || currentTaskFilter === 'Completed') ? 'flex' : 'none';

  allTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.id = `task-${task.id}`;

    const prioClass = (task.priority || 'medium').toLowerCase();
    const prioLabel = task.priority === 'High' ? '🔴 High' : task.priority === 'Low' ? '🟢 Low' : '🟡 Medium';
    const dueDateStr = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date';

    let sourceLinkHtml = '';
    if (task.email_id) {
      sourceLinkHtml = `
        <span class="kanban-card-source" onclick="viewSourceEmail(${task.email_id})" title="Source Email: ${escHtml(task.email_subject)}">
          📧 Email Ref
        </span>
      `;
    }

    let actionButtons = '';
    if (task.status === 'To Do') {
      actionButtons = `
        <button class="kanban-card-btn move-btn" onclick="updateStatus(${task.id}, 'In Progress')" title="Move to In Progress">▶️ Start</button>
      `;
    } else if (task.status === 'In Progress') {
      actionButtons = `
        <button class="kanban-card-btn" onclick="updateStatus(${task.id}, 'To Do')" title="Move to To Do">◀️ Back</button>
        <button class="kanban-card-btn move-btn" onclick="updateStatus(${task.id}, 'Completed')" title="Complete Task">✅ Complete</button>
      `;
    } else if (task.status === 'Completed') {
      actionButtons = `
        <button class="kanban-card-btn" onclick="updateStatus(${task.id}, 'In Progress')" title="Reopen Task">↩️ Reopen</button>
      `;
    }

    card.innerHTML = `
      <div class="kanban-card-title">${escHtml(task.title)}</div>
      <div class="kanban-card-desc">${escHtml(task.description || '')}</div>
      <div class="kanban-card-meta">
        <span class="badge badge-${prioClass}">${prioLabel}</span>
        <span class="kanban-card-due">📅 ${dueDateStr}</span>
      </div>
      <div class="kanban-card-meta">
        ${sourceLinkHtml}
        <div style="display:flex; gap: 4px;">
          <button class="kanban-card-btn" onclick="openEditTaskModal(${task.id})" title="Edit Task">✏️</button>
          <button class="kanban-card-btn" onclick="deleteTask(${task.id})" title="Delete Task" style="color:var(--red);">🗑️</button>
        </div>
      </div>
      <div class="kanban-card-actions">
        ${actionButtons}
      </div>
    `;

    if (task.status === 'To Do') {
      todoBody.appendChild(card);
      todoCount++;
    } else if (task.status === 'In Progress') {
      inProgressBody.appendChild(card);
      inProgressCount++;
    } else if (task.status === 'Completed') {
      completedBody.appendChild(card);
      completedCount++;
    }
  });

  document.getElementById('count-todo').textContent = todoCount;
  document.getElementById('count-in-progress').textContent = inProgressCount;
  document.getElementById('count-completed').textContent = completedCount;
}

function viewSourceEmail(emailId) {
  const email = allEmails.find(e => e.id === emailId);
  if (!email) {
    alert('Source email not found in currently loaded list.');
    return;
  }
  
  // Create dynamic modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '1000';
  
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.style.maxWidth = '600px';
  
  card.innerHTML = `
    <div class="modal-header">
      <h3>Email Reference Details</h3>
      <button class="modal-close" id="closeEmailRefModalBtn">&times;</button>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; margin-top:15px; font-size:0.9rem;">
      <div><strong>From:</strong> ${escHtml(email.sender)}</div>
      <div><strong>Subject:</strong> ${escHtml(email.subject)}</div>
      <div><strong>Received:</strong> ${new Date(email.received_at).toLocaleString()}</div>
      <div style="border-top: 1px solid var(--border); padding-top: 12px; margin-top: 6px;">
        <strong>Content Summary:</strong>
        <p style="color:var(--text-secondary); margin-top:4px;">${escHtml(email.summary || 'No summary available.')}</p>
      </div>
      <div style="border-top: 1px solid var(--border); padding-top: 12px; max-height: 250px; overflow-y: auto;">
        <strong>Email Body:</strong>
        <pre style="background:var(--bg-primary); padding:10px; border-radius:var(--radius-sm); font-family:inherit; white-space:pre-wrap; margin-top:4px; color:var(--text-secondary); font-size:0.85rem;">${escHtml(email.body || 'Empty message body')}</pre>
      </div>
    </div>
    <div class="modal-actions" style="display:flex; justify-content:flex-end; margin-top:15px;">
      <button class="btn-primary" id="closeEmailRefModalCloseBtn">Close</button>
    </div>
  `;
  
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  
  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#closeEmailRefModalBtn').onclick = close;
  overlay.querySelector('#closeEmailRefModalCloseBtn').onclick = close;
}

async function updateStatus(taskId, newStatus) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: task.title,
        description: task.description,
        status: newStatus,
        priority: task.priority,
        due_date: task.due_date
      })
    });
    const data = await res.json();
    if (data.success) {
      task.status = newStatus;
      renderKanbanBoard();
    } else {
      alert('Failed to update status: ' + data.message);
    }
  } catch (e) {
    alert('Error updating status: ' + e.message);
  }
}

function openCreateTaskModal() {
  document.getElementById('taskForm').reset();
  document.getElementById('taskEditId').value = '';
  document.getElementById('taskModalTitle').textContent = 'Create Personal Task';
  document.getElementById('taskStatusGroup').style.display = 'none';
  document.getElementById('taskSubmitBtn').textContent = 'Create Task';
  document.getElementById('taskModal').style.display = 'flex';
}

function openEditTaskModal(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  document.getElementById('taskEditId').value = task.id;
  document.getElementById('taskTitle').value = task.title;
  document.getElementById('taskDescription').value = task.description || '';
  document.getElementById('taskPriority').value = task.priority || 'Medium';
  document.getElementById('taskDueDate').value = task.due_date ? task.due_date.substring(0, 10) : '';
  document.getElementById('taskStatus').value = task.status || 'To Do';
  
  document.getElementById('taskModalTitle').textContent = 'Edit Task Details';
  document.getElementById('taskStatusGroup').style.display = 'block';
  document.getElementById('taskSubmitBtn').textContent = 'Save Changes';
  document.getElementById('taskModal').style.display = 'flex';
}

function closeTaskModal() {
  document.getElementById('taskModal').style.display = 'none';
}

async function submitTaskForm(e) {
  e.preventDefault();
  const editId = document.getElementById('taskEditId').value;
  const title = document.getElementById('taskTitle').value;
  const description = document.getElementById('taskDescription').value;
  const priority = document.getElementById('taskPriority').value;
  const due_date = document.getElementById('taskDueDate').value || null;
  const status = document.getElementById('taskStatus').value;

  try {
    if (editId) {
      const res = await fetch(`/api/tasks/${editId}`, {
        method: 'PUT',
        headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, status, priority, due_date })
      });
      const data = await res.json();
      if (data.success) {
        closeTaskModal();
        loadTasks();
      } else {
        alert('Error: ' + data.message);
      }
    } else {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority, due_date })
      });
      const data = await res.json();
      if (data.success) {
        closeTaskModal();
        loadTasks();
      } else {
        alert('Error: ' + data.message);
      }
    }
  } catch (err) {
    alert('Error saving task: ' + err.message);
  }
}

async function deleteTask(taskId) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: AUTH_HEADERS
    });
    const data = await res.json();
    if (data.success) {
      loadTasks();
    } else {
      alert('Error deleting task: ' + data.message);
    }
  } catch (e) {
    alert('Error deleting task: ' + e.message);
  }
}

// ── AI Composer & Outbound Email Writer ─────────────────────────────────────
async function generateComposerEmail() {
  const prompt = document.getElementById('compPrompt').value;
  const tone = document.getElementById('compTone').value;
  const length = document.getElementById('compLength').value;
  const reference_email = document.getElementById('compRefEmail').value;

  if (!prompt) {
    alert('Please enter some instructions or a prompt for the AI.');
    return;
  }

  const loader = document.getElementById('compLoading');
  const textSpan = document.getElementById('compLoadingText');
  textSpan.textContent = 'AI is writing your draft...';
  loader.style.display = 'flex';

  try {
    const res = await fetch('/api/generate-email', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tone, length, reference_email })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('compOutput').value = data.draft;
    } else {
      alert('AI Generation Failed: ' + data.message);
    }
  } catch (e) {
    alert('Error generating email: ' + e.message);
  } finally {
    loader.style.display = 'none';
  }
}

async function sendComposerEmail() {
  const recipient = document.getElementById('compRecipient').value;
  const subject = document.getElementById('compSubject').value;
  const body = document.getElementById('compOutput').value;

  if (!recipient || !subject || !body) {
    alert('Please make sure recipient email, subject, and output body draft are populated.');
    return;
  }

  if (!confirm(`Are you sure you want to send this email to ${recipient}?`)) return;

  const loader = document.getElementById('compLoading');
  const textSpan = document.getElementById('compLoadingText');
  textSpan.textContent = 'Sending email via SMTP...';
  loader.style.display = 'flex';

  try {
    const res = await fetch('/api/send-custom-email', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, subject, body })
    });
    const data = await res.json();
    if (data.success) {
      alert('Email sent successfully!');
      // Clear composer forms
      document.getElementById('compRecipient').value = '';
      document.getElementById('compSubject').value = '';
      document.getElementById('compPrompt').value = '';
      document.getElementById('compRefEmail').value = '';
      document.getElementById('compOutput').value = '';
    } else {
      alert('Failed to send email: ' + data.message);
    }
  } catch (e) {
    alert('Error sending email: ' + e.message);
  } finally {
    textSpan.textContent = 'AI is writing your draft...';
    loader.style.display = 'none';
  }
}

// ── Sent Emails Logs ────────────────────────────────────────────────────────
let sentSearchQuery = '';

function renderSentLogs() {
  const tbody = document.getElementById('sentLogsBody');
  if (!tbody) return;

  const sentEmails = allEmails.filter(e => {
    // Only display sent emails
    if (e.status !== 'Sent') return false;

    if (sentSearchQuery) {
      const q = sentSearchQuery;
      const matchSender = (e.sender || '').toLowerCase().includes(q);
      const matchSubject = (e.subject || '').toLowerCase().includes(q);
      const matchReply = (e.draft_reply || '').toLowerCase().includes(q);
      return matchSender || matchSubject || matchReply;
    }
    return true;
  });

  if (sentEmails.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No sent emails logged yet. Approve a draft to send.</td></tr>`;
    return;
  }

  tbody.innerHTML = sentEmails.map(e => {
    const formattedDate = new Date(e.received_at).toLocaleString();
    const truncatedReply = e.draft_reply && e.draft_reply.length > 85 
      ? e.draft_reply.substring(0, 85) + '...' 
      : (e.draft_reply || 'No reply text');

    return `
      <tr>
        <td style="font-weight:600; color:var(--text-primary); word-break:break-all;">${e.sender}</td>
        <td style="color:var(--text-secondary); max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${e.subject || '(No Subject)'}</td>
        <td><span class="pill pill-${(e.category || 'important').toLowerCase()}">${e.category || 'important'}</span></td>
        <td style="font-family:monospace; font-size:0.8rem; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${e.draft_reply || ''}">${truncatedReply}</td>
        <td style="color:var(--text-muted); font-size:0.8rem;">${formattedDate}</td>
        <td style="text-align:center;">
          <button class="action-btn-view" onclick="openMonitoringEmailModal(${e.id})" title="View Details" style="background:rgba(99,102,241,0.1); border:none; border-radius:4px; padding:6px 12px; color:var(--accent); cursor:pointer;">
            👁️ View
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function onSentSearch(val) {
  sentSearchQuery = (val || '').toLowerCase().trim();
  renderSentLogs();
}

// ── Onboarding Handlers ──────────────────────────────────────────────────────
function autoSuggestOnboardImap() {
  const email = document.getElementById('onboardEmail').value.trim();
  if (!email || !email.includes('@')) return;

  const domain = email.split('@')[1].toLowerCase();
  let server = 'imap.' + domain;
  let port = '993';

  if (domain === 'gmail.com') {
    server = 'imap.gmail.com';
  } else if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com' || domain === 'office365.com') {
    server = 'outlook.office365.com';
  } else if (domain === 'yahoo.com') {
    server = 'imap.mail.yahoo.com';
  }

  document.getElementById('onboardImapServer').value = server;
  document.getElementById('onboardImapPort').value = port;
  document.getElementById('onboardImapUser').value = email;
}

async function submitOnboardingForm(e) {
  e.preventDefault();
  const email = document.getElementById('onboardEmail').value.trim();
  const imap_server = document.getElementById('onboardImapServer').value.trim();
  const imap_port = document.getElementById('onboardImapPort').value.trim();
  const imap_user = document.getElementById('onboardImapUser').value.trim();
  const imap_password = document.getElementById('onboardImapPassword').value;

  const msgDiv = document.getElementById('onboardingMessage');
  msgDiv.style.display = 'none';
  msgDiv.className = 'auth-message';

  const btn = document.getElementById('onboardingSubmitBtn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Connecting...';

  try {
    const res = await fetch('/api/imap-accounts', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, imap_server, imap_port, imap_user, imap_password })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('onboardingOverlay').style.display = 'none';
      isOnboardingActive = false;
      
      // Spawn sync agent in background so they get fresh mock/real emails immediately
      fetch('/api/run-agent', { method: 'POST', headers: AUTH_HEADERS }).catch(() => {});

      await refreshData();
    } else {
      msgDiv.style.display = 'block';
      msgDiv.className = 'auth-message error-message';
      msgDiv.textContent = data.message;
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Connect Mailbox & Get Started';
    }
  } catch (err) {
    msgDiv.style.display = 'block';
    msgDiv.className = 'auth-message error-message';
    msgDiv.textContent = 'Connection failed: ' + err.message;
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Connect Mailbox & Get Started';
  }
}
