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
let lastSyncTimestamp = null;
let previousTotalEmailCount = -1;
let isLiveSyncActive = false;
let isLiveConnected = true; // Assumed connected until first health check

// ── Theme Engine (Bright / Dark Mode) ───────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('app_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  updateThemeUI();
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('app_theme', isLight ? 'light' : 'dark');
  updateThemeUI();
  showToast(isLight ? '☀️ Bright Mode Enabled' : '🌙 Dark Mode Enabled', 'info');
}

function updateThemeUI() {
  const isLight = document.body.classList.contains('light-mode');
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  const row = document.getElementById('sidebarThemeBtn');
  if (icon) icon.textContent = isLight ? '🌙' : '☀️';
  if (label) label.textContent = isLight ? 'Dark Mode' : 'Bright Mode';
  if (row) row.title = isLight ? 'Switch to Dark Mode' : 'Switch to Bright Mode';
}


// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Bright/Dark theme
  initTheme();

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

  // Start Lively Real-time Background Monitoring (Checks every 15s)
  startLiveMonitoring();
});


// ── Live Monitoring Engine ──────────────────────────────────────────────────
function startLiveMonitoring() {
  // Initial check
  checkMonitoringHealth();

  // Poll monitoring status and new emails every 5 seconds for real-time live inbox
  setInterval(async () => {
    await checkMonitoringHealth();
  }, 5000);

  // Update time-ago ticker every 3 seconds
  setInterval(updateLiveTicker, 3000);
}

async function checkMonitoringHealth() {
  try {
    const res = await fetch('/api/monitoring/status', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      isLiveSyncActive = data.isSyncing;
      // Use isConnected from server — true only if accounts exist + sync < 3 min ago
      isLiveConnected = data.isConnected !== undefined ? data.isConnected : (data.accountsCount > 0);
      if (data.lastSyncTimestamp) {
        lastSyncTimestamp = new Date(data.lastSyncTimestamp);
      }
      updateLiveBadgeUI();
    }
    // Refresh emails quietly in the background
    await loadEmails(true);
  } catch (err) {
    console.error('Monitoring health check error:', err);
  }
}

function updateLiveTicker() {
  const timeSub = document.getElementById('liveTimeSub');
  if (!timeSub) return;
  if (isLiveSyncActive) {
    timeSub.textContent = 'Syncing...';
    return;
  }
  if (!lastSyncTimestamp) {
    timeSub.textContent = 'Every 60s';
    return;
  }
  const diffSec = Math.floor((Date.now() - lastSyncTimestamp.getTime()) / 1000);
  if (diffSec < 10) {
    timeSub.textContent = 'Just synced';
  } else if (diffSec < 60) {
    timeSub.textContent = `${diffSec}s ago`;
  } else {
    const mins = Math.floor(diffSec / 60);
    timeSub.textContent = mins > 2 ? `⚠️ ${mins}m ago` : `${mins}m ago`;
  }
}

function updateLiveBadgeUI() {
  const badge = document.getElementById('liveStatusBadge');
  const dot = document.getElementById('liveDot');
  const text = document.getElementById('liveStatusText');
  if (!badge || !dot || !text) return;

  if (isLiveSyncActive) {
    badge.style.borderColor = 'rgba(245,158,11,0.4)';
    dot.className = 'live-pulse-dot pulsing-amber';
    text.textContent = 'Syncing Inbox...';
  } else if (!isLiveConnected) {
    // No accounts connected or sync stale
    badge.style.borderColor = 'rgba(239,68,68,0.4)';
    dot.className = 'live-pulse-dot pulsing-red';
    text.textContent = 'Not Connected';
  } else {
    badge.style.borderColor = '';
    dot.className = 'live-pulse-dot pulsing-green';
    text.textContent = 'Live Monitor Active';
  }
  updateLiveTicker();
}

async function triggerLiveCheck() {
  const syncBtn = document.getElementById('btnRunSync');
  const syncIcon = document.getElementById('syncIcon');
  if (syncIcon) syncIcon.style.animation = 'spin 1s linear infinite';
  
  showToast('🔄 Running live inbox sync...');
  isLiveSyncActive = true;
  updateLiveBadgeUI();

  try {
    const res = await fetch('/api/run-agent', { method: 'POST', headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      showToast('✓ ' + data.message, 'success');
      await refreshData();
    } else {
      showToast('✕ ' + data.message, 'error');
    }
  } catch (err) {
    showToast('✕ Sync error: ' + err.message, 'error');
  } finally {
    isLiveSyncActive = false;
    lastSyncTimestamp = new Date();
    updateLiveBadgeUI();
    if (syncIcon) syncIcon.style.animation = '';
  }
}

// Simple Toast Notification helper
function showToast(message, type = 'info') {
  const existing = document.getElementById('appGlobalToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'appGlobalToast';
  const bg = type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#4f46e5';
  toast.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:${bg};color:white;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:500;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,0.35);animation:fadeIn 0.25s ease;display:flex;align-items:center;gap:8px;`;
  toast.innerHTML = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

// ── Tab Navigation ──────────────────────────────────────────────────────────
function switchTab(tab) {
  // Update nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Update mobile bottom nav dock buttons
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Auto-close mobile drawer if open
  if (typeof closeMobileMenu === 'function') {
    closeMobileMenu();
  }

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
      
      const currentUserId = parseInt(USER_ID, 10);
      const myAccounts = allImapAccounts.filter(acc => !acc.user_id || acc.user_id === currentUserId);
      
      const prompt = document.getElementById('addMailboxPrompt');
      
      if (myAccounts.length === 0) {
        if (prompt) prompt.style.display = 'block';
        isOnboardingActive = false;
        return false;
      } else {
        if (prompt) prompt.style.display = 'none';
        isOnboardingActive = false;
        return false;
      }
    }
  } catch (e) {
    console.error('Onboarding check error:', e);
  }
  return false;
}

// ── Google OAuth Connect ──────────────────────────────────────────────────
function connectWithGoogle() {
  const userId = USER_ID || '';
  const token = SESSION_TOKEN || '';
  window.location.href = `/auth/google?token=${encodeURIComponent(token)}&userId=${encodeURIComponent(userId)}`;
}

// Handle OAuth redirect results
(function handleOAuthResult() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('oauth_success') === 'true') {
    // Clean URL
    window.history.replaceState({}, '', '/dashboard.html');
    setTimeout(() => {
      showToast('✓ Google account connected successfully!', 'success');
    }, 500);
  } else if (params.get('oauth_error')) {
    window.history.replaceState({}, '', '/dashboard.html');
    const errorMap = {
      'no_code': 'Google authorization was cancelled.',
      'session_expired': 'Your session expired. Please log in again.',
      'token_failed': 'Failed to exchange Google token. Please try again.',
      'no_email': 'Could not retrieve email from Google.',
      'missing_gmail_permission': 'Gmail permission was not granted. Please ensure the Gmail API is enabled in Google Cloud Console and check the Gmail permission box when authorizing.',
      'missing_client_id': 'Google OAuth Client ID is not configured on this server/Vercel. Please add GOOGLE_CLIENT_ID in Vercel Settings or connect via App Password.',
      'server_error': 'Server error during OAuth. Please try again.'
    };
    const errMsg = errorMap[params.get('oauth_error')] || 'OAuth connection failed.';
    setTimeout(() => {
      showToast('✕ ' + errMsg, 'error');
    }, 500);
  }
})();

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

async function loadEmails(isSilentBackground = false) {
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
      const prevCount = allEmails.length;
      allEmails = data.emails;
      
      // If new emails arrived during live background monitoring, notify the user!
      if (previousTotalEmailCount !== -1 && allEmails.length > previousTotalEmailCount && isSilentBackground) {
        const diff = allEmails.length - previousTotalEmailCount;
        const newest = allEmails[0];
        showToast(`📬 ${diff} new email received from <strong>${escHtml(newest.sender)}</strong>!`, 'success');
      }
      previousTotalEmailCount = allEmails.length;

      renderMonitoring();
      renderDraftsList();
      renderSentLogs();
    }
  } catch (e) { console.error('Emails error:', e); }
}

// ── Email Deletion & Quick Clean ────────────────────────────────────────────
async function deleteEmail(id) {
  if (!confirm('Are you sure you want to delete this email?')) return;
  try {
    const res = await fetch(`/api/emails/${id}`, { method: 'DELETE', headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      showToast('✓ ' + data.message, 'success');
      refreshData();
    } else {
      showToast('✕ ' + data.message, 'error');
    }
  } catch (e) {
    showToast('✕ Error: ' + e.message, 'error');
  }
}

async function quickCleanJunk() {
  if (!confirm('Clean all spam, promotional clutter, delivery notification failures, and password reset loops?')) return;
  try {
    const res = await fetch('/api/emails/clean-junk', { method: 'POST', headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ ${data.message}`, 'success');
      refreshData();
    } else {
      showToast('✕ ' + data.message, 'error');
    }
  } catch (e) {
    showToast('✕ Error: ' + e.message, 'error');
  }
}

// Helpers for initials and color
function getInitials(nameOrEmail) {
  if (!nameOrEmail) return '??';
  let cleaned = nameOrEmail.split('@')[0].replace(/[._-]/g, ' ');
  const parts = cleaned.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return nameOrEmail.substring(0, 2).toUpperCase();
}

function getAvatarGradient(str) {
  const gradients = [
    'linear-gradient(135deg, #6366f1, #8b5cf6)',
    'linear-gradient(135deg, #06b6d4, #3b82f6)',
    'linear-gradient(135deg, #10b981, #059669)',
    'linear-gradient(135deg, #f59e0b, #d97706)',
    'linear-gradient(135deg, #ec4899, #8b5cf6)',
    'linear-gradient(135deg, #3b82f6, #1d4ed8)'
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

function formatRelativeTime(isoStr) {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  } catch {
    return 'Recent';
  }
}


// ── Monitoring Controller (Priority & Category Separation) ─────────────────
function filterPriority(priority) {
  currentPriorityFilter = priority;
  
  // Update priority buttons active state
  document.querySelectorAll('[data-priority]').forEach(btn => {
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
  document.querySelectorAll('[data-filter]').forEach(btn => {
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
  setTxt('mobileInboxBadge', allEmails.length);

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
      if (currentFilter === 'person') {
        // person filter removed — fall through to all
      } else if (currentFilter !== 'all' && (e.category || '').toLowerCase() !== currentFilter.toLowerCase()) {
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

  // Draft Reply & Auto-Send controls
  const draftBox = document.getElementById('monModalDraftReplyBox');
  const draftPre = document.getElementById('monModalDraftReply');
  const statusEl = document.getElementById('monModalAutoReplyStatus');
  const toggleBtn = document.getElementById('monModalToggleAutoSendBtn');
  const editDraftBtn = document.getElementById('monModalEditDraftBtn');

  if (draftBox && draftPre) {
    if (email.draft_reply) {
      draftBox.style.display = 'block';
      draftPre.textContent = email.draft_reply;
      
      const isScheduled = email.send_at && new Date(email.send_at) > new Date() && !email.requires_approval;
      if (statusEl) {
        if (email.requires_approval) {
          statusEl.innerHTML = '<span style="color:#f59e0b; font-weight:600;">⚠️ Paused (Requires Approval)</span>';
        } else if (isScheduled) {
          statusEl.innerHTML = '<span style="color:#10b981; font-weight:600;">⚡ Auto-Send Active</span>';
        } else {
          statusEl.innerHTML = '<span style="color:#94a3b8; font-weight:600;">⏸️ Auto-Send Off</span>';
        }
      }

      if (toggleBtn) {
        toggleBtn.textContent = isScheduled ? '⏸️ Pause Auto-Send' : '▶️ Enable Auto-Send';
        toggleBtn.onclick = toggleAutoSendForCurrentEmail;
      }

      if (editDraftBtn) {
        editDraftBtn.onclick = () => {
          closeMonitoringEmailModal();
          openEditModal(email.id);
        };
      }
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

async function toggleAutoSendForCurrentEmail() {
  if (!currentModalEmail) return;
  const id = currentModalEmail.id;
  try {
    const res = await fetch(`/api/emails/${id}/toggle-autosend`, { method: 'POST', headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success) {
      currentModalEmail.send_at = data.send_at;
      // Re-render modal status
      openMonitoringEmailModal(currentModalEmail);
      // Refresh list
      refreshData();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (e) {
    alert('Failed to toggle auto-send: ' + e.message);
  }
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

// ── AI Drafts State & Controller ───────────────────────────────────────────
let currentDraftSubTab = 'active'; // 'active', 'expired', 'important', 'history'
let currentDraftCategory = 'all'; // 'all', 'important', 'person', 'general'
let currentDraftSearch = '';

function filterDraftsSubTab(tabName) {
  currentDraftSubTab = tabName;
  const tabIds = {
    'active': 'draftTabActive',
    'expired': 'draftTabExpired',
    'important': 'draftTabImportant',
    'history': 'draftTabHistory'
  };
  ['draftTabActive', 'draftTabExpired', 'draftTabImportant', 'draftTabHistory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === tabIds[tabName]);
  });
  renderDraftsList();
}

function filterDraftCategory(catName) {
  currentDraftCategory = catName;
  const catIds = {
    'all': 'btnDraftCatAll',
    'important': 'btnDraftCatImportant',
    'person': 'btnDraftCatPerson',
    'general': 'btnDraftCatGeneral'
  };
  ['btnDraftCatAll', 'btnDraftCatImportant', 'btnDraftCatPerson', 'btnDraftCatGeneral'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === catIds[catName]);
  });
  renderDraftsList();
}

function onDraftSearch(val) {
  currentDraftSearch = (val || '').toLowerCase().trim();
  const clearBtn = document.getElementById('draftSearchClear');
  if (clearBtn) clearBtn.style.display = currentDraftSearch ? 'inline-block' : 'none';
  renderDraftsList();
}

function clearDraftSearch() {
  const input = document.getElementById('draftSearchInput');
  if (input) input.value = '';
  currentDraftSearch = '';
  const clearBtn = document.getElementById('draftSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderDraftsList();
}

function checkIsOver20Mins(email) {
  if (!email) return false;
  // If email timer was scheduled and expired
  if (email.send_at) {
    const diff = new Date(email.send_at).getTime() - Date.now();
    if (diff <= 0) return true;
  }
  // If received more than 20 minutes ago
  if (email.received_at) {
    const ageMs = Date.now() - new Date(email.received_at).getTime();
    if (ageMs > 20 * 60 * 1000) return true;
  }
  return false;
}

function formatDraftDateTime(isoStr) {
  if (!isoStr) return { dateStr: 'Recent', relStr: '' };
  try {
    const d = new Date(isoStr);
    const dateStr = d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const relStr = formatRelativeTime(isoStr);
    return { dateStr, relStr };
  } catch {
    return { dateStr: 'Recent', relStr: '' };
  }
}

// ── Render Drafts List ──────────────────────────────────────────────────────
function renderDraftsList() {
  const container = document.getElementById('draftsList');
  if (!container) return;

  // Clear old countdown intervals
  countdownIntervals.forEach(id => clearInterval(id));
  countdownIntervals = [];

  // All emails with draft reply
  const allDraftEmails = allEmails.filter(e => !!e.draft_reply);

  // 1. Categorize drafts
  const pendingAll = allDraftEmails.filter(e => e.status === 'Pending' || !e.status);
  const processedAll = allDraftEmails.filter(e => e.status !== 'Pending' && !!e.status);

  const activeDraftsAll = pendingAll.filter(e => !checkIsOver20Mins(e));
  const expiredDraftsAll = pendingAll.filter(e => checkIsOver20Mins(e));
  const importantDraftsAll = allDraftEmails.filter(e => {
    const cat = (e.category || '').toLowerCase();
    const prio = (e.priority || '').toLowerCase();
    return cat === 'important' || prio === 'high';
  });

  // 2. Update Stats & Tab Badges
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('statDraftsActive', activeDraftsAll.length);
  setTxt('statDraftsExpired', expiredDraftsAll.length);
  setTxt('statDraftsImportant', importantDraftsAll.length);
  setTxt('statDraftsSent', processedAll.length);

  setTxt('badgeDraftActive', activeDraftsAll.length);
  setTxt('badgeDraftExpired', expiredDraftsAll.length);
  setTxt('badgeDraftImportant', importantDraftsAll.length);
  setTxt('badgeDraftHistory', processedAll.length);

  // 3. Select items based on sub-tab
  let selectedList = [];
  let tabTitle = '';
  let tabSubDesc = '';

  if (currentDraftSubTab === 'active') {
    // Only top 20 active drafts contained in the first tab
    selectedList = activeDraftsAll.slice(0, 20);
    tabTitle = `⚡ Active Draft Queue (≤ 20m) — Showing ${selectedList.length} of ${activeDraftsAll.length}`;
    tabSubDesc = `Freshly generated AI draft replies ready for review or scheduled auto-dispatch within 20 minutes (Max 20 per batch).`;
  } else if (currentDraftSubTab === 'expired') {
    selectedList = expiredDraftsAll;
    tabTitle = `🕒 Expired / Older Drafts (> 20m) (${expiredDraftsAll.length})`;
    tabSubDesc = `Drafts that have exceeded the 20-minute active auto-dispatch window or older messages held for manual review.`;
  } else if (currentDraftSubTab === 'important') {
    selectedList = importantDraftsAll;
    tabTitle = `⭐ Important & High Priority Pitches (${importantDraftsAll.length})`;
    tabSubDesc = `High-value pitch drafts tailored for clients, career inquiries, interviews, and business contacts.`;
  } else {
    selectedList = processedAll;
    tabTitle = `📜 Processed & Sent Drafts History (${processedAll.length})`;
    tabSubDesc = `Historical archive of approved, auto-sent, and archived email reply dispatches.`;
  }

  // 4. Apply Category filter
  if (currentDraftCategory === 'important') {
    selectedList = selectedList.filter(e => (e.category || '').toLowerCase() === 'important');
  } else if (currentDraftCategory === 'person') {
    selectedList = selectedList.filter(e => (e.category || '').toLowerCase() === 'important');
  } else if (currentDraftCategory === 'general') {
    selectedList = selectedList.filter(e => (e.category || '').toLowerCase() !== 'important');
  }

  // 5. Apply Search filter
  if (currentDraftSearch) {
    selectedList = selectedList.filter(e => {
      const text = `${e.sender || ''} ${e.subject || ''} ${e.summary || ''} ${e.draft_reply || ''} ${e.intent || ''}`.toLowerCase();
      return text.includes(currentDraftSearch);
    });
  }

  // 6. Render Output
  let html = `
    <div class="drafts-section-header" style="margin-bottom: 16px;">
      <h3 style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <span>${escHtml(tabTitle)}</span>
        ${currentDraftSubTab === 'active' && activeDraftsAll.length > 20 ? '<span class="badge badge-medium" style="font-size:0.75rem;">Showing Top 20 Active</span>' : ''}
      </h3>
      <p style="font-size:0.83rem; color:var(--text-secondary); margin-top:4px;">${escHtml(tabSubDesc)}</p>
    </div>
  `;

  if (!selectedList.length) {
    const emptyMsg = currentDraftSubTab === 'expired' 
      ? 'Great job! No expired drafts pending review.'
      : currentDraftSubTab === 'active'
      ? 'No active drafts in the 20-min window. Run the agent to sync fresh incoming emails.'
      : 'No drafts found matching current filters.';

    html += `
      <div class="empty-state-card" style="padding: 48px 24px; text-align:center;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4; margin-bottom:12px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <p style="color:var(--text-secondary); font-size:0.95rem;">${emptyMsg}</p>
        <button class="btn btn-primary" onclick="triggerLiveCheck()" style="margin-top:14px; font-size:0.85rem; padding:7px 16px;">⚡ Run Agent Ingestion</button>
      </div>
    `;
    container.innerHTML = html;
    return;
  }

  html += `<div class="drafts-grid">` + selectedList.map(e => {
    const acc = allImapAccounts.find(a => a.id === e.imap_account_id);
    const accText = acc ? `To: ${escHtml(acc.email)}` : '';
    const { dateStr, relStr } = formatDraftDateTime(e.received_at);
    const pLower = (e.priority || 'medium').toLowerCase();
    const cLower = (e.category || 'important').toLowerCase();
    const isOver20 = checkIsOver20Mins(e);
    const isPending = e.status === 'Pending' || !e.status;

    let timerHtml = '';
    if (e.requires_approval) {
      timerHtml = `<div class="draft-timer expired">⚠️ Approval Required</div>`;
    } else if (isPending) {
      if (isOver20) {
        timerHtml = `<div class="draft-timer expired" title="Exceeded 20m window">🕒 Expired (> 20m)</div>`;
      } else if (e.send_at) {
        timerHtml = `<div class="draft-timer" id="timer-${e.id}" data-send-at="${e.send_at}">⏱ Calculating...</div>`;
      } else {
        timerHtml = `<div class="draft-timer" style="background:rgba(99,102,241,0.15); color:var(--accent); border-color:rgba(99,102,241,0.3);">⚡ Pending Dispatch</div>`;
      }
    } else {
      let statusBadge = '<span class="badge badge-low">Sent</span>';
      if (e.status === 'Auto-Sent') statusBadge = '<span class="badge badge-medium">Auto-Sent</span>';
      if (e.status === 'Rejected') statusBadge = '<span class="badge badge-high">Rejected</span>';
      timerHtml = `<div class="draft-status">${statusBadge}</div>`;
    }

    return `
      <div class="draft-card ${!isPending ? 'processed-draft' : ''} ${isOver20 && isPending ? 'draft-card-expired' : ''}" id="draft-${e.id}">
        <!-- Top Header & Date/Time info -->
        <div class="draft-header">
          <div style="flex: 1; min-width: 0;">
            <div class="draft-meta-top-row">
              <span class="draft-date-chip">📅 ${escHtml(dateStr)} ${relStr ? `<strong style="opacity:0.85;">(${escHtml(relStr)})</strong>` : ''}</span>
              <span class="badge badge-${pLower}">${escHtml(e.priority || 'Medium')}</span>
              <span class="pill pill-${cLower}">${escHtml(e.category || 'Important')}</span>
              ${e.intent ? `<span class="intent-tag">🎯 ${escHtml(e.intent)}</span>` : ''}
            </div>
            <div class="draft-sender" style="margin-top:6px;">
              ↩ Reply to: <strong>${escHtml(e.sender)}</strong> ${accText ? `<span style="opacity:0.65; font-size:0.78rem; margin-left:6px;">(${accText})</span>` : ''}
            </div>
            <div class="draft-subject">${escHtml(e.subject || 'No Subject')}</div>
          </div>
          <div style="flex-shrink:0; margin-left:12px;">
            ${timerHtml}
          </div>
        </div>

        <!-- Summary & Draft Content -->
        ${e.summary ? `<div class="draft-summary">📋 <strong>Summary:</strong> ${escHtml(e.summary)}</div>` : ''}
        <div class="draft-body">
          <div class="draft-body-header">
            <span>🤖 AI Drafted Pitch / Response:</span>
          </div>
          <div class="draft-body-content">${escHtml(e.draft_reply)}</div>
        </div>

        <!-- Action Buttons -->
        <div class="draft-actions">
          ${isPending ? `
            <button class="btn-approve" onclick="approveDraft(${e.id})">✅ Approve & Send</button>
            <button class="btn-edit" onclick="openEditModal(${e.id})">✏️ Edit Pitch</button>
            <button class="btn-reject" onclick="rejectDraft(${e.id})">❌ Reject</button>
            <button class="btn-reject" onclick="deleteEmail(${e.id})" title="Delete email" style="background:rgba(239,68,68,0.08); border-color:rgba(239,68,68,0.2);">🗑️ Delete</button>
          ` : `
            <button class="btn-card-view" onclick="openMonitoringEmailModal(${e.id})" style="font-size:0.8rem; padding:6px 12px;">👁️ View Details</button>
            <button class="btn-reject" onclick="deleteEmail(${e.id})" title="Delete email" style="font-size:0.8rem; padding:4px 10px; margin-left:auto;">🗑️ Delete</button>
          `}
        </div>
      </div>

    `;
  }).join('') + `</div>`;

  container.innerHTML = html;

  // Start countdown timers for active drafts
  if (currentDraftSubTab === 'active' || currentDraftSubTab === 'important') {
    selectedList.forEach(e => {
      if (e.send_at && !e.requires_approval && (e.status === 'Pending' || !e.status) && !checkIsOver20Mins(e)) {
        const timerId = setInterval(() => updateTimer(e.id, e.send_at, timerId), 1000);
        countdownIntervals.push(timerId);
        updateTimer(e.id, e.send_at, timerId);
      }
    });
  }
}

function updateTimer(emailId, sendAt, intervalId) {
  const el = document.getElementById(`timer-${emailId}`);
  if (!el) { clearInterval(intervalId); return; }

  const diff = new Date(sendAt) - new Date();
  if (diff <= 0) {
    el.textContent = '🕒 Expired (> 20m)';
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
    showToast('✓ ' + data.message, 'success');
    refreshData();
  } catch (e) { showToast('✕ Error: ' + e.message, 'error'); }
}

async function rejectDraft(id) {
  if (!confirm('Reject this draft? It will not be sent.')) return;
  try {
    const res = await fetch(`/api/emails/${id}/reject`, { method: 'POST', headers: AUTH_HEADERS });
    const data = await res.json();
    showToast('✓ ' + data.message, 'success');
    refreshData();
  } catch (e) { showToast('✕ Error: ' + e.message, 'error'); }
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
    showToast('✓ ' + data.message, 'success');
    closeEditModal();
    refreshData();
  } catch (e) { showToast('✕ Error: ' + e.message, 'error'); }
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

  // Load auto-reply rules & global settings
  try {
    const res = await fetch('/api/settings', { headers: AUTH_HEADERS });
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      
      // Auto-reply rules
      const masterEl = document.getElementById('ruleMasterAutoReply');
      if (masterEl) {
        masterEl.checked = s.rule_master_autoreply !== 'false';
        toggleAutoReplyFormState(masterEl.checked);
      }

      const delayEl = document.getElementById('ruleAutoSendDelay');
      if (delayEl && s.rule_delay_mins !== undefined && s.rule_delay_mins !== null) {
        delayEl.value = s.rule_delay_mins;
      }

      const impEl = document.getElementById('ruleReplyImportant');
      if (impEl) impEl.checked = s.rule_reply_important !== 'false';

      const promoEl = document.getElementById('ruleReplyPromotion');
      if (promoEl) promoEl.checked = s.rule_reply_promotion === 'true';

      const newsEl = document.getElementById('ruleReplyNewsletter');
      if (newsEl) newsEl.checked = s.rule_reply_newsletter === 'true';

      const spamEl = document.getElementById('ruleReplySpam');
      if (spamEl) spamEl.checked = s.rule_reply_spam === 'true';

      // Admin global settings
      if (USER_ROLE === 'admin') {
        const gemKey = document.getElementById('setGeminiKey');
        const gemMod = document.getElementById('setGeminiModel');
        if (gemKey) gemKey.value = s.gemini_api_key || '';
        if (gemMod) gemMod.value = s.gemini_model || '';
      }
    }
  } catch (e) { console.error('Settings load error:', e); }

  if (USER_ROLE === 'admin') {
    try {
      const usersRes = await fetch('/api/users', { headers: AUTH_HEADERS });
      const usersData = await usersRes.json();
      if (usersData.success) {
        allUsersList = usersData.users;
        const select = document.getElementById('accountAdminUserSelect');
        if (select) {
          select.innerHTML = allUsersList.map(u => `<option value="${u.id}">${u.email} (${u.role})</option>`).join('');
        }
      }
    } catch (e) { console.error('Admin users load error:', e); }
  }
}

function toggleAutoReplyFormState(enabled) {
  const container = document.getElementById('autoReplyOptionsContainer');
  if (container) {
    container.style.opacity = enabled ? '1' : '0.45';
    container.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

async function saveAutoReplySettings() {
  const btn = document.getElementById('saveAutoReplyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  const settings = {
    rule_master_autoreply: document.getElementById('ruleMasterAutoReply').checked ? 'true' : 'false',
    rule_delay_mins: document.getElementById('ruleAutoSendDelay').value,
    rule_reply_important: document.getElementById('ruleReplyImportant').checked ? 'true' : 'false',
    rule_reply_promotion: document.getElementById('ruleReplyPromotion').checked ? 'true' : 'false',
    rule_reply_newsletter: document.getElementById('ruleReplyNewsletter').checked ? 'true' : 'false',
    rule_reply_spam: document.getElementById('ruleReplySpam').checked ? 'true' : 'false'
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    });
    const data = await res.json();
    if (data.success) {
      // Toast message
      const msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#059669;color:white;padding:12px 24px;border-radius:8px;font-size:0.9rem;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      msg.textContent = '✓ Auto-Reply rules saved successfully!';
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 3500);
    } else {
      alert('Error: ' + data.message);
    }
  } catch (e) {
    alert('Failed to save settings: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Rules'; }
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
            <button type="button" class="action-btn-view" onclick="openEditAccountModal(${acc.id}, '${escHtml(acc.email)}')" style="padding:4px 8px; font-size:0.75rem; background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; cursor:pointer;">✏️ Edit</button>
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

function openEditAccountModal(id, email) {
  document.getElementById('accountForm').reset();
  document.getElementById('accountEditId').value = id;
  document.getElementById('accountEmail').value = email;
  document.getElementById('accountEmail').disabled = true;
  document.getElementById('accountImapPassword').placeholder = '•••••••• (Enter new to change)';
  
  document.getElementById('accountModalTitle').textContent = 'Edit Connection Settings';
  document.getElementById('accountSubmitBtn').textContent = 'Save Changes';
  document.getElementById('accountAdminUserSelectGroup').style.display = 'none';
  
  document.getElementById('accountModal').style.display = 'flex';
}

function closeAccountModal() {
  document.getElementById('accountModal').style.display = 'none';
}

async function submitAccountForm(e) {
  e.preventDefault();
  const editId = document.getElementById('accountEditId').value;
  const email = document.getElementById('accountEmail').value.trim();
  const imap_password = document.getElementById('accountImapPassword').value;
  const userId = document.getElementById('accountAdminUserSelect')?.value || null;

  if (!editId && !imap_password) {
    alert('Password is required when connecting a new mailbox.');
    return;
  }

  const payload = { email, imap_password };
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
      showToast('✓ ' + data.message, 'success');
      // Clear composer forms
      document.getElementById('compRecipient').value = '';
      document.getElementById('compSubject').value = '';
      document.getElementById('compPrompt').value = '';
      document.getElementById('compRefEmail').value = '';
      document.getElementById('compOutput').value = '';
      // Refresh data so the sent email immediately shows in Sent Logs!
      await refreshData();
      renderSentLogs();
    } else {
      showToast('✕ ' + data.message, 'error');
    }
  } catch (e) {
    showToast('✕ Error sending email: ' + e.message, 'error');
  } finally {
    textSpan.textContent = 'AI is writing your draft...';
    loader.style.display = 'none';
  }
}

// ── Sent Emails Logs ────────────────────────────────────────────────────────
let sentSearchQuery = '';
let currentSentTypeFilter = 'all'; // 'all', 'composer', 'auto', 'approved'

function filterSentLogsType(type) {
  currentSentTypeFilter = type;
  const btnMap = {
    'all': 'btnSentTypeAll',
    'composer': 'btnSentTypeComposer',
    'auto': 'btnSentTypeAuto',
    'approved': 'btnSentTypeApproved'
  };
  ['btnSentTypeAll', 'btnSentTypeComposer', 'btnSentTypeAuto', 'btnSentTypeApproved'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === btnMap[type]);
  });
  renderSentLogs();
}

function onSentSearch(val) {
  sentSearchQuery = (val || '').toLowerCase().trim();
  const clearBtn = document.getElementById('sentSearchClear');
  if (clearBtn) clearBtn.style.display = sentSearchQuery ? 'inline-block' : 'none';
  renderSentLogs();
}

function clearSentSearch() {
  const input = document.getElementById('sentSearchInput');
  if (input) input.value = '';
  sentSearchQuery = '';
  const clearBtn = document.getElementById('sentSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderSentLogs();
}

function renderSentLogs() {
  const tbody = document.getElementById('sentLogsBody');
  if (!tbody) return;

  // 1. Filter all outbound / sent emails
  const allSentList = allEmails.filter(e => {
    const st = (e.status || '').toLowerCase();
    const cat = (e.category || '').toLowerCase();
    return cat === 'composer' || st === 'sent' || st === 'auto-sent' || st === 'approved' || (e.draft_reply && st !== 'pending' && st !== 'rejected');
  });

  // 2. Update stats cards
  const composerCount = allSentList.filter(e => (e.category || '').toLowerCase() === 'composer').length;
  const autoCount = allSentList.filter(e => (e.status || '').toLowerCase() === 'auto-sent').length;
  const approvedCount = allSentList.filter(e => (e.status || '').toLowerCase() === 'sent' && (e.category || '').toLowerCase() !== 'composer').length;

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('statSentTotal', allSentList.length);
  setTxt('statSentComposer', composerCount);
  setTxt('statSentAuto', autoCount);
  setTxt('statSentApproved', approvedCount);

  // 3. Apply type filter
  let filtered = allSentList;
  if (currentSentTypeFilter === 'composer') {
    filtered = filtered.filter(e => (e.category || '').toLowerCase() === 'composer');
  } else if (currentSentTypeFilter === 'auto') {
    filtered = filtered.filter(e => (e.status || '').toLowerCase() === 'auto-sent');
  } else if (currentSentTypeFilter === 'approved') {
    filtered = filtered.filter(e => (e.status || '').toLowerCase() === 'sent' && (e.category || '').toLowerCase() !== 'composer');
  }

  // 4. Apply search filter
  if (sentSearchQuery) {
    const q = sentSearchQuery;
    filtered = filtered.filter(e => {
      const matchSender = (e.sender || '').toLowerCase().includes(q);
      const matchSubject = (e.subject || '').toLowerCase().includes(q);
      const matchReply = (e.draft_reply || e.body || '').toLowerCase().includes(q);
      return matchSender || matchSubject || matchReply;
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No sent emails found matching your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const isComposer = (e.category || '').toLowerCase() === 'composer';
    const isAuto = (e.status || '').toLowerCase() === 'auto-sent';

    let typeBadge = '';
    if (isComposer) {
      typeBadge = `<span class="badge" style="background:rgba(129,140,248,0.18); color:#818cf8; border:1px solid rgba(129,140,248,0.3); font-size:0.75rem; padding:3px 8px; border-radius:12px; font-weight:600;">✍️ Composer</span>`;
    } else if (isAuto) {
      typeBadge = `<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-size:0.75rem; padding:3px 8px; border-radius:12px; font-weight:600;">⚡ Auto-Sent</span>`;
    } else {
      typeBadge = `<span class="badge" style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.3); font-size:0.75rem; padding:3px 8px; border-radius:12px; font-weight:600;">✅ Approved</span>`;
    }

    const dateVal = e.received_at ? new Date(e.received_at) : new Date();
    const formattedDate = dateVal.toLocaleString();
    const sentText = e.draft_reply || e.body || 'No message content';
    const truncatedReply = sentText.length > 90 ? sentText.substring(0, 90) + '...' : sentText;

    return `
      <tr>
        <td>${typeBadge}</td>
        <td style="font-weight:600; color:var(--text-primary); word-break:break-all;">${escHtml(e.sender || 'Direct Outbound')}</td>
        <td style="color:var(--text-secondary); max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(e.subject || '')}">${escHtml(e.subject || '(No Subject)')}</td>
        <td><span class="pill pill-${(e.category || 'important').toLowerCase()}">${escHtml(e.category || 'general')}</span></td>
        <td style="font-family:monospace; font-size:0.8rem; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escHtml(sentText)}">${escHtml(truncatedReply)}</td>
        <td style="color:var(--text-muted); font-size:0.8rem;">${escHtml(formattedDate)}</td>
        <td style="text-align:center;">
          <button class="action-btn-view" onclick="openMonitoringEmailModal(${e.id})" title="View Details" style="background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.25); border-radius:4px; padding:5px 10px; color:var(--accent); cursor:pointer; font-size:0.78rem;">
            👁️ View
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Inbox Overload Quick Clean ──────────────────────────────────────────────
async function quickCleanJunk() {
  if (!confirm('🧹 Clean Clutter: Do you want to purge all Spam, Promotional, and Newsletter emails to de-clutter your inbox?')) {
    return;
  }

  try {
    const res = await fetch('/api/clean-inbox', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purgeCategories: ['spam', 'promotion', 'newsletter'], olderThanDays: 0 })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✨ Cleaned!\n${data.message}`);
      refreshData();
    } else {
      alert('Failed: ' + data.message);
    }
  } catch (err) {
    alert('Error cleaning inbox: ' + err.message);
  }
}



