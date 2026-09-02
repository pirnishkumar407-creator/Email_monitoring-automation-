// backend/server.js — Main Node.js HTTP API Server
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, stmts, hashPassword, createUser, loadEnv, encrypt, decrypt } = require('./db');

// Load environment variables from .env into process.env
const envVars = loadEnv();
for (const key in envVars) {
  if (!process.env[key]) {
    process.env[key] = envVars[key];
  }
}

const PORT = 3000;

// ── Google OAuth 2.0 Configuration ──────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = `http://localhost:${PORT}/auth/google/callback`;
const GOOGLE_SCOPES = 'https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid';

// Helper to automatically configure IMAP based on email domain
function autoConfigureImap(userId, email, password) {
  try {
    const emailLower = email.toLowerCase().trim();
    const existing = db.prepare(`SELECT id FROM imap_accounts WHERE user_id = ? AND email = ?`).get(userId, emailLower);
    if (existing) return;

    let server = '';
    const domain = emailLower.split('@')[1] || '';
    if (domain === 'gmail.com') {
      server = 'imap.gmail.com';
    } else if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com' || domain === 'office365.com') {
      server = 'outlook.office365.com';
    } else if (domain === 'yahoo.com') {
      server = 'imap.mail.yahoo.com';
    } else {
      server = 'imap.' + domain;
    }

    const encryptedPass = encrypt(password);
    const createdAt = new Date().toISOString();
    stmts.insertImapAccount.run(userId, emailLower, server, 993, emailLower, encryptedPass, createdAt);
    console.log(`[Auto-Config] Configured IMAP for user ID ${userId} with email ${emailLower} and server ${server}`);
  } catch (err) {
    console.error('[Auto-Config Error]', err.message);
  }
}

// ── Helper: Parse JSON body ─────────────────────────────────────────────────
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', err => { reject(err); });
  });
}

// ── Helper: JSON response ───────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Helper: Get user from session token ──────────────────────────────────────
function getAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;

  try {
    const now = new Date().toISOString();
    stmts.deleteExpiredSessions.run(now);
  } catch (err) {
    console.error('[Session Cleanup Error]', err.message);
  }

  try {
    const session = stmts.getSession.get(token);
    if (!session) return null;
    const now = new Date();
    const expiry = new Date(session.expires_at);
    if (now > expiry) {
      stmts.deleteSession.run(token);
      return null;
    }
    return stmts.getUserById.get(session.user_id);
  } catch (err) {
    console.error('[Auth Error]', err.message);
    return null;
  }
}

// ── Auto-Send Timer ─────────────────────────────────────────────────────────
function checkAutoSend() {
  try {
    const now = new Date().toISOString();
    const pending = stmts.getPendingAutoSend.all(now);
    for (const email of pending) {
      const account = email.imap_account_id ? stmts.getImapAccountById.get(email.imap_account_id) : null;
      let smtpServer = null;
      let smtpUser = null;
      let smtpPass = null;
      if (account) {
        smtpServer = account.imap_server;
        smtpUser = account.imap_user;
        smtpPass = decrypt(account.imap_password);
      } else {
        const senderUser = email.user_id ? stmts.getUserById.get(email.user_id) : null;
        if (senderUser) {
          smtpServer = senderUser.imap_server;
          smtpUser = senderUser.imap_user;
          smtpPass = decrypt(senderUser.imap_password);
        }
      }
      let authType = (account && account.auth_type) || 'password';
      let oauthRefreshToken = null;
      if (account && authType === 'oauth' && account.oauth_refresh_token) {
        oauthRefreshToken = decrypt(account.oauth_refresh_token);
      }

      // Spawn send_email.py
      const { spawn } = require('child_process');
      const child = spawn('python', [path.join(__dirname, 'send_email.py')]);
      const payload = JSON.stringify({
        recipient: email.sender,
        subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
        body: email.draft_reply,
        smtp_server: smtpServer,
        smtp_user: smtpUser,
        smtp_pass: smtpPass,
        auth_type: authType,
        oauth_refresh_token: oauthRefreshToken
      });
      child.stdin.write(payload);
      child.stdin.end();
      child.on('close', (code) => {
        if (code === 0) {
          stmts.updateEmailStatus.run('Auto-Sent', email.id);
          console.log(`[Auto-Send] Email ${email.id} auto-sent to ${email.sender}`);
        } else {
          stmts.updateEmailStatus.run('Failed', email.id);
          console.error(`[Auto-Send] Failed to send email ${email.id} (status updated to Failed)`);
        }
      });

    }
  } catch (err) {
    console.error('[Auto-Send Error]', err.message);
  }
}

// Auto-send timer: Check every 60 seconds
setInterval(checkAutoSend, 60000);

// Auto-sync timer: Live background email monitoring (checks every 60s)
let isAgentSyncing = false;
let lastSyncTimestamp = new Date().toISOString();
let lastSyncStatus = 'idle';

function autoSyncEmails() {
  if (isAgentSyncing) return;
  isAgentSyncing = true;
  lastSyncStatus = 'syncing';
  const { spawn } = require('child_process');
  const child = spawn('python', [path.join(__dirname, 'agent.py')], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  let output = '';
  if (child.stdout) child.stdout.on('data', d => { output += d; });
  if (child.stderr) child.stderr.on('data', d => { output += d; });

  // Give the full Gmail IMAP + Gemini API cycle time to complete (90s)
  const timeoutId = setTimeout(() => {
    try { child.kill(); } catch (_) {}
    isAgentSyncing = false;
    lastSyncStatus = 'timeout';
    lastSyncTimestamp = new Date().toISOString();
    console.log('[Auto-Sync] Agent timed out after 90s');
  }, 90000);

  child.on('close', (code) => {
    clearTimeout(timeoutId);
    isAgentSyncing = false;
    lastSyncTimestamp = new Date().toISOString();
    lastSyncStatus = code === 0 ? 'ok' : 'error';
    if (code !== 0) {
      console.log('[Auto-Sync] Agent exited with code', code, output.slice(-300));
    }
  });
  child.on('error', (err) => {
    clearTimeout(timeoutId);
    isAgentSyncing = false;
    lastSyncStatus = 'error';
    console.error('[Auto-Sync Error]', err.message);
  });
}
// Run every 60 seconds for live background inbox monitoring
setInterval(autoSyncEmails, 60000);
// Also run once immediately on server start after 5 seconds
setTimeout(autoSyncEmails, 5000);



// ── Content Types Map ───────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  // ── API: Sign Up ────────────────────────────────────────────────────────
  if (url.pathname === '/api/signup' && method === 'POST') {
    try {
      const { email, password } = await parseJsonBody(req);
      if (!email || !password) return json(res, 400, { success: false, message: 'Email and password are required.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { success: false, message: 'Invalid email address.' });
      if (password.length < 6) {
        return json(res, 400, {
          success: false,
          message: 'Password must be at least 6 characters long.'
        });
      }

      const existing = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (existing) return json(res, 409, { success: false, message: 'This email is already registered.' });

      createUser(email, password, 'user');
      return json(res, 201, { success: true, message: 'Account created! You can now sign in.' });
    } catch (err) {
      console.error('Signup error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Login ──────────────────────────────────────────────────────────
  if (url.pathname === '/api/login' && method === 'POST') {
    try {
      const { email, password } = await parseJsonBody(req);
      if (!email || !password) return json(res, 400, { success: false, message: 'Email and password are required.' });

      const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (!user) return json(res, 401, { success: false, message: 'Invalid email or password.' });

      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) return json(res, 401, { success: false, message: 'Invalid email or password.' });

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      stmts.insertSession.run(sessionToken, user.id, expiresAt);

      return json(res, 200, {
        success: true,
        message: 'Login successful!',
        token: sessionToken,
        user: { id: user.id, email: user.email, role: user.role }
      });
    } catch (err) {
      console.error('Login error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Forgot Password (OTP Generation & Email Send) ────────────────────
  if (url.pathname === '/api/forgot-password' && method === 'POST') {
    try {
      const { email } = await parseJsonBody(req);
      if (!email) return json(res, 400, { success: false, message: 'Email is required.' });

      const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (!user) return json(res, 404, { success: false, message: 'This email is not registered.' });

      // Generate a 6-digit OTP code
      const otp = crypto.randomInt(100000, 999999).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
      const tokenValue = `${otp}:${expiresAt}`;

      // Save OTP to DB
      stmts.updateUserResetToken.run(tokenValue, user.id);

      // Send Email via send_email.py subprocess
      const { spawn } = require('child_process');
      const child = spawn('python', [path.join(__dirname, 'send_email.py')]);
      let stdout = '', stderr = '';

      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });

      child.on('close', code => {
        if (code === 0) {
          return json(res, 200, { success: true, message: 'OTP sent to your email.' });
        } else {
          console.error(`Forgot password SMTP error: ${stderr || stdout}`);
          return json(res, 502, { success: false, message: 'Failed to send OTP email via SMTP.' });
        }
      });

      const payload = JSON.stringify({
        recipient: user.email,
        subject: 'AI Email Automation — Password Reset OTP',
        body: `Hello,\n\nYou requested to reset your password. Your OTP code is:\n\n${otp}\n\nThis OTP is valid for 10 minutes. If you did not request this, please ignore this email.\n\nBest regards,\nAI Email Automation Team`
      });
      child.stdin.write(payload);
      child.stdin.end();
      return;

    } catch (err) {
      console.error('Forgot password error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Reset Password (OTP Verification & Password Save) ────────────────
  if (url.pathname === '/api/reset-password' && method === 'POST') {
    try {
      const { email, otp, password } = await parseJsonBody(req);
      if (!email || !otp || !password) {
        return json(res, 400, { success: false, message: 'Email, OTP, and new password are required.' });
      }

      const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (!user) return json(res, 404, { success: false, message: 'This email is not registered.' });

      // Validate password complexity
      if (password.length < 6) {
        return json(res, 400, {
          success: false,
          message: 'Password must be at least 6 characters long.'
        });
      }

      // Verify OTP
      if (!user.reset_token) {
        return json(res, 400, { success: false, message: 'Invalid or expired OTP.' });
      }

      const parts = user.reset_token.split(':');
      if (parts.length !== 2) {
        return json(res, 400, { success: false, message: 'Invalid or expired OTP.' });
      }

      const [savedOtp, expiryStr] = parts;
      const expiry = parseInt(expiryStr, 10);

      if (savedOtp !== otp || Date.now() > expiry) {
        return json(res, 400, { success: false, message: 'Invalid or expired OTP.' });
      }

      // OTP is valid, hash new password and save
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      stmts.updateUserPassword.run(hash, salt, user.id);

      return json(res, 200, { success: true, message: 'Password has been reset successfully. You can now sign in.' });
    } catch (err) {
      console.error('Reset password error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }


  // ── API: Admin Overview & System Stats ──────────────────────────────────
  if (url.pathname === '/api/admin/overview' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const stats = stmts.getAdminOverview.get();
      const byCategory = stmts.getEmailsByCategory.all();
      const byPriority = stmts.getEmailsByPriority.all();
      const byDay = stmts.getEmailsByDay.all();

      const db_key_raw = stmts.getSetting.get('gemini_api_key')?.value;
      const db_key = db_key_raw ? decrypt(db_key_raw) : null;
      const env_key = process.env.GEMINI_API_KEY;
      const hasApiKey = Boolean((db_key && !db_key.startsWith('test-key') && !db_key.startsWith('•••')) || (env_key && env_key !== 'your_gemini_api_key_here'));
      const activeModel = stmts.getSetting.get('gemini_model')?.value || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

      return json(res, 200, {
        success: true,
        overview: {
          ...stats,
          ai_configured: hasApiKey,
          gemini_model: activeModel,
          byCategory,
          byPriority,
          byDay
        }
      });
    } catch (err) {
      console.error('Admin overview error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Get All Users (Admin only) ─────────────────────────────────────
  if (url.pathname === '/api/users' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const users = stmts.getAllUsersDetailed.all();
      return json(res, 200, { success: true, users });
    } catch (err) {
      console.error('Get users error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Create User (Admin only) ───────────────────────────────────────
  if (url.pathname === '/api/users' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const { email, password, role } = await parseJsonBody(req);
      if (!email || !password) return json(res, 400, { success: false, message: 'Email and password are required.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { success: false, message: 'Invalid email address format.' });
      if (password.length < 6) return json(res, 400, { success: false, message: 'Password must be at least 6 characters.' });

      const existing = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (existing) return json(res, 409, { success: false, message: 'A user with this email already exists.' });

      const assignedRole = (role === 'admin') ? 'admin' : 'user';
      createUser(email, password, assignedRole);
      return json(res, 201, { success: true, message: `User ${email} created successfully as ${assignedRole}!` });
    } catch (err) {
      console.error('Admin create user error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Update User Role (Admin only) ──────────────────────────────────
  if (url.pathname.match(/^\/api\/users\/\d+\/role$/) && method === 'PUT') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      const { role } = await parseJsonBody(req);
      if (role !== 'admin' && role !== 'user') return json(res, 400, { success: false, message: 'Role must be "admin" or "user".' });

      const targetUser = stmts.getUserById.get(id);
      if (!targetUser) return json(res, 404, { success: false, message: 'User not found.' });

      if (targetUser.role === 'admin' && role === 'user') {
        const adminCount = stmts.countAdmins.get().count;
        if (adminCount <= 1) {
          return json(res, 400, { success: false, message: 'Cannot demote the only administrator.' });
        }
      }

      stmts.updateUserRole.run(role, id);
      return json(res, 200, { success: true, message: `User role updated to ${role}.` });
    } catch (err) {
      console.error('Update role error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Reset User Password by Admin ───────────────────────────────────
  if (url.pathname.match(/^\/api\/users\/\d+\/password$/) && method === 'PUT') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      const { password } = await parseJsonBody(req);
      if (!password || password.length < 6) {
        return json(res, 400, { success: false, message: 'Password must be at least 6 characters long.' });
      }

      const targetUser = stmts.getUserById.get(id);
      if (!targetUser) return json(res, 404, { success: false, message: 'User not found.' });

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      stmts.updateUserPassword.run(hash, salt, id);

      return json(res, 200, { success: true, message: `Password for ${targetUser.email} has been updated!` });
    } catch (err) {
      console.error('Admin reset password error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Delete User (Admin only) ───────────────────────────────────────
  if (url.pathname.match(/^\/api\/users\/\d+$/) && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      if (id === user.id) {
        return json(res, 400, { success: false, message: 'You cannot delete your own admin account while logged in.' });
      }
      const targetUser = stmts.getUserById.get(id);
      if (!targetUser) return json(res, 404, { success: false, message: 'User not found.' });

      // Clean up user's related data
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM tasks WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM emails WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM imap_accounts WHERE user_id = ?`).run(id);
      stmts.deleteUserAny.run(id);

      return json(res, 200, { success: true, message: `User ${targetUser.email} and associated data deleted.` });
    } catch (err) {
      console.error('Delete user error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Admin Mailbox Fleet Oversight ──────────────────────────────────
  if (url.pathname === '/api/admin/mailboxes' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const mailboxes = stmts.getAllMailboxesDetailed.all();
      mailboxes.forEach(m => {
        m.imap_password = m.imap_password ? '••••••••' : '';
      });
      return json(res, 200, { success: true, mailboxes });
    } catch (err) {
      console.error('Admin get mailboxes error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  if (url.pathname.match(/^\/api\/admin\/mailboxes\/\d+$/) && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      stmts.deleteImapAccountAdmin.run(id);
      return json(res, 200, { success: true, message: 'Mailbox disconnected from fleet.' });
    } catch (err) {
      console.error('Admin delete mailbox error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Test Gemini Connectivity ───────────────────────────────────────
  if (url.pathname === '/api/admin/test-gemini' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const { apiKey, model } = await parseJsonBody(req);
      const db_key_raw = stmts.getSetting.get('gemini_api_key')?.value;
      const db_key = db_key_raw ? decrypt(db_key_raw) : null;
      const keyToUse = (apiKey && !apiKey.startsWith('••••') && apiKey.trim() !== '') ? apiKey.trim() : (db_key || process.env.GEMINI_API_KEY);
      const modelToUse = model || stmts.getSetting.get('gemini_model')?.value || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

      if (!keyToUse || keyToUse === 'your_gemini_api_key_here') {
        return json(res, 400, { success: false, message: 'No valid Gemini API key found to test.' });
      }

      const start = Date.now();
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${keyToUse}`;
      const resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with the single word "OK" only.' }] }]
        })
      });

      const durationMs = Date.now() - start;

      if (!resp.ok) {
        const errTxt = await resp.text();
        return json(res, 400, { success: false, message: `Gemini API Error (${resp.status}): ${errTxt}` });
      }

      const data = await resp.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Connected';

      return json(res, 200, {
        success: true,
        message: `Gemini AI is healthy & responding! Latency: ${durationMs}ms`,
        model: modelToUse,
        latencyMs: durationMs,
        response: reply
      });
    } catch (err) {
      console.error('Test Gemini error:', err);
      return json(res, 500, { success: false, message: 'Failed to test Gemini: ' + err.message });
    }
  }

  // ── API: Get Emails ─────────────────────────────────────────────────────
  if (url.pathname === '/api/emails' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const emails = user.role === 'admin' ? stmts.getEmails.all() : stmts.getEmailsByUser.all(user.id);
      emails.forEach(e => {
        try { e.action_items = JSON.parse(e.action_items); } catch { e.action_items = []; }
      });
      return json(res, 200, { success: true, emails });
    } catch (err) {
      console.error('Fetch emails error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Live Monitoring Status ─────────────────────────────────────────
  if (url.pathname === '/api/monitoring/status' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const userAccounts = user.role === 'admin' 
        ? db.prepare(`SELECT COUNT(*) as count FROM imap_accounts`).get().count
        : stmts.getImapAccountsByUser.all(user.id).length;

      // Calculate how many seconds since last successful sync
      const secsSinceSync = Math.floor((Date.now() - new Date(lastSyncTimestamp).getTime()) / 1000);

      return json(res, 200, {
        success: true,
        isSyncing: isAgentSyncing,
        lastSyncTimestamp: lastSyncTimestamp,
        lastSyncStatus: lastSyncStatus,
        secsSinceLastSync: secsSinceSync,
        accountsCount: userAccounts,
        // connected = has accounts + last sync was within 3 minutes
        isConnected: userAccounts > 0 && secsSinceSync < 180
      });
    } catch (err) {
      return json(res, 500, { success: false, message: err.message });
    }
  }


  // ── API: Run Email Sync / Agent Simulation ──────────────────────────────
  if (url.pathname === '/api/run-agent' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const { spawn } = require('child_process');
      
      // Determine if active user or admin has IMAP configuration
      let hasImap = false;
      if (user.role === 'admin') {
        const globalImapUser = stmts.getSetting.get('imap_user')?.value;
        const globalImapServer = stmts.getSetting.get('imap_server')?.value;
        const globalImapPassword = stmts.getSetting.get('imap_password')?.value;
        const totalAccounts = db.prepare(`SELECT COUNT(*) as count FROM imap_accounts`).get().count;
        hasImap = (totalAccounts > 0) || !!(globalImapUser && globalImapServer && globalImapPassword);
      } else {
        const userAccounts = stmts.getImapAccountsByUser.all(user.id);
        hasImap = userAccounts.length > 0;
      }

      // Check if we should spawn in simulation mode or real sync mode
      const args = [`--user-id`, `${user.id}`];
      if (!hasImap) {
        args.push('--simulate');
      }

      isAgentSyncing = true;
      const child = spawn('python', [path.join(__dirname, 'agent.py'), ...args]);
      let stdout = '', stderr = '';
      
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });

      child.on('close', code => {
        isAgentSyncing = false;
        lastSyncTimestamp = new Date().toISOString();
        if (code === 0) {
          return json(res, 200, { 
            success: true, 
            message: hasImap 
              ? 'AI email agent synchronization completed successfully!' 
              : 'Simulation run complete. Fresh mock emails and drafts generated successfully!' 
          });
        } else {
          console.error(`Run agent error (exit code ${code}): ${stderr || stdout}`);
          return json(res, 502, { success: false, message: `Email sync failed: ${stderr || stdout}` });
        }
      });
      child.on('error', (err) => {
        isAgentSyncing = false;
        return json(res, 500, { success: false, message: err.message });
      });
      return;
    } catch (err) {
      isAgentSyncing = false;
      console.error('Run agent endpoint error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }


  // ── API: Approve Email Draft ────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/emails\/\d+\/approve$/) && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      const email = stmts.getEmailById.get(id);
      if (!email) return json(res, 404, { success: false, message: 'Email not found.' });

      const account = email.imap_account_id ? stmts.getImapAccountById.get(email.imap_account_id) : null;
      let smtpServer = null;
      let smtpUser = null;
      let smtpPass = null;
      if (account) {
        smtpServer = account.imap_server;
        smtpUser = account.imap_user;
        smtpPass = decrypt(account.imap_password);
      } else {
        const senderUser = email.user_id ? stmts.getUserById.get(email.user_id) : null;
        if (senderUser) {
          smtpServer = senderUser.imap_server;
          smtpUser = senderUser.imap_user;
          smtpPass = decrypt(senderUser.imap_password);
        }
      }

      let authType = (account && account.auth_type) || 'password';
      let oauthRefreshToken = null;
      if (account && authType === 'oauth' && account.oauth_refresh_token) {
        oauthRefreshToken = decrypt(account.oauth_refresh_token);
      }

      const { spawn } = require('child_process');
      const child = spawn('python', [path.join(__dirname, 'send_email.py')]);
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('close', code => {
        if (code === 0) {
          stmts.updateEmailStatus.run('Sent', id);
          return json(res, 200, { success: true, message: 'Draft approved and sent!' });
        } else {
          return json(res, 502, { success: false, message: `SMTP failed: ${stderr || stdout}` });
        }
      });
      const payload = JSON.stringify({
        recipient: email.sender,
        subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
        body: email.draft_reply,
        smtp_server: smtpServer,
        smtp_user: smtpUser,
        smtp_pass: smtpPass,
        auth_type: authType,
        oauth_refresh_token: oauthRefreshToken
      });
      child.stdin.write(payload);
      child.stdin.end();
      return;
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Reject Email Draft ─────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/emails\/\d+\/reject$/) && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      stmts.updateEmailStatus.run('Rejected', id);
      return json(res, 200, { success: true, message: 'Draft rejected.' });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Edit Email Draft ───────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/emails\/\d+\/edit$/) && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      const { draft_reply } = await parseJsonBody(req);
      if (draft_reply === undefined) return json(res, 400, { success: false, message: 'draft_reply required.' });
      
      const email = stmts.getEmailById.get(id);
      if (!email) return json(res, 404, { success: false, message: 'Email not found.' });

      // If it requires approval, do not set/reset the send_at timer
      const newSendAt = email.requires_approval ? null : new Date(Date.now() + 20 * 60 * 1000).toISOString();
      const editedAt = new Date().toISOString();
      stmts.updateEmailDraft.run(draft_reply, editedAt, newSendAt, id);

      const message = email.requires_approval 
        ? 'Draft updated. It remains waiting for your manual approval.' 
        : 'Draft updated. Timer reset to 20 minutes.';
      return json(res, 200, { success: true, message });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Toggle Auto-Send for Email ─────────────────────────────────────
  if (url.pathname.match(/^\/api\/emails\/\d+\/toggle-autosend$/) && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      const email = stmts.getEmailById.get(id);
      if (!email) return json(res, 404, { success: false, message: 'Email not found.' });

      let newSendAt = null;
      let message = '';
      if (email.send_at && new Date(email.send_at) > new Date()) {
        // Pause/Disable auto-send
        newSendAt = null;
        message = 'Auto-send paused. This email will not be sent automatically.';
      } else {
        // Schedule auto-send (default: 20 minutes)
        newSendAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
        message = 'Auto-send scheduled for dispatch in 20 minutes.';
      }

      db.prepare(`UPDATE emails SET send_at = ? WHERE id = ?`).run(newSendAt, id);
      return json(res, 200, { success: true, send_at: newSendAt, message });
    } catch (err) {
      console.error('Toggle autosend error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Delete Single Email ────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/emails\/\d+$/) && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      stmts.deleteTasksByEmail.run(id);
      if (user.role === 'admin') {
        stmts.deleteEmailAdmin.run(id);
      } else {
        stmts.deleteEmailByUser.run(id, user.id);
      }
      return json(res, 200, { success: true, message: 'Email deleted successfully.' });
    } catch (err) {
      console.error('Delete email error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Clean Junk / Spam / Automated Test Mails ───────────────────────
  if (url.pathname === '/api/emails/clean-junk' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const condition = user.role === 'admin' ? '' : `AND user_id = ${user.id}`;
      // Clean spam, promotional clutter, delivery notification failures, and password reset loops
      const query = `
        DELETE FROM emails 
        WHERE (
          category IN ('spam', 'promotion') 
          OR sender LIKE '%mailer-daemon%' 
          OR sender LIKE '%no-reply%' 
          OR sender LIKE '%noreply%' 
          OR subject LIKE '%Password Reset OTP%'
          OR subject LIKE '%Delivery Status Notification%'
        ) ${condition}
      `;
      const result = db.prepare(query).run();
      return json(res, 200, { 
        success: true, 
        deletedCount: result.changes, 
        message: `Successfully cleaned ${result.changes} junk and automated test email(s).` 
      });
    } catch (err) {
      console.error('Clean junk error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }


  // ── API: Dashboard Stats ────────────────────────────────────────────────
  if (url.pathname === '/api/stats' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const stats = user.role === 'admin' ? stmts.getStats.get() : stmts.getStatsByUser.get(user.id);
      return json(res, 200, {
        success: true,
        stats: { total: stats.total || 0, urgent: stats.urgent || 0, drafted: stats.drafted || 0, sent: stats.sent || 0 }
      });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Analytics ──────────────────────────────────────────────────────
  if (url.pathname === '/api/analytics' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const byDay = stmts.getEmailsByDay.all();
      const byCategory = stmts.getEmailsByCategory.all();
      const byPriority = stmts.getEmailsByPriority.all();
      const responseRate = stmts.getResponseRate.get();

      return json(res, 200, {
        success: true,
        analytics: {
          byDay, byCategory, byPriority,
          responseRate: responseRate.total > 0 ? Math.round((responseRate.responded / responseRate.total) * 100) : 0
        }
      });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Get Settings ───────────────────────────────────────────────────
  if (url.pathname === '/api/settings' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const settings = {};
      
      // Auto-reply rule keys (shared)
      const ruleKeys = [
        'rule_master_autoreply',
        'rule_delay_mins',
        'rule_reply_important',
        'rule_reply_promotion',
        'rule_reply_newsletter',
        'rule_reply_spam'
      ];

      ruleKeys.forEach(k => {
        const row = stmts.getSetting.get(k);
        settings[k] = row ? row.value : null;
      });

      if (user.role === 'admin') {
        // Admin sees global settings
        const keys = ['gemini_api_key', 'gemini_model', 'imap_server', 'imap_port', 'imap_user', 'imap_password'];
        keys.forEach(k => {
          const row = stmts.getSetting.get(k);
          let val = row ? row.value : '';
          if (val && (k === 'gemini_api_key' || k === 'imap_password')) {
            settings[k] = val.length > 8 ? `••••••••${val.substring(val.length - 4)}` : '••••••••';
          } else {
            settings[k] = val;
          }
        });
      } else {
        // User sees own IMAP settings
        settings.imap_server = user.imap_server || '';
        settings.imap_user = user.imap_user || '';
        settings.imap_password = user.imap_password ? '••••••••' : '';
      }
      return json(res, 200, { success: true, settings, role: user.role });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Save Settings ──────────────────────────────────────────────────
  if (url.pathname === '/api/settings' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const body = await parseJsonBody(req);
      const s = body.settings || {};

      // Save auto-reply rules (allowed for all users)
      const allowedRuleKeys = [
        'rule_master_autoreply',
        'rule_delay_mins',
        'rule_reply_important',
        'rule_reply_promotion',
        'rule_reply_newsletter',
        'rule_reply_spam'
      ];
      
      allowedRuleKeys.forEach(k => {
        if (s[k] !== undefined && s[k] !== null) {
          stmts.setSetting.run(k, String(s[k]));
        }
      });

      if (user.role === 'admin') {
        Object.keys(s).forEach(k => {
          if (allowedRuleKeys.includes(k)) return;
          const val = s[k];
          if (val !== undefined && val !== null && typeof val === 'string' && !val.startsWith('•••')) {
            const finalVal = (k === 'imap_password' || k === 'gemini_api_key') ? encrypt(val) : val;
            stmts.setSetting.run(k, finalVal);
          }
        });
      } else {
        // User can only update their own IMAP
        if (s.imap_server) {
          const encPassword = s.imap_password && !s.imap_password.startsWith('•••') ? encrypt(s.imap_password) : user.imap_password;
          stmts.updateUserImap.run(s.imap_server, s.imap_user || '', encPassword, user.id);
        }
      }
      return json(res, 200, { success: true, message: 'Settings and auto-reply rules saved!' });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Get IMAP Accounts ──────────────────────────────────────────────
  if (url.pathname === '/api/imap-accounts' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      let accounts;
      if (user.role === 'admin' && url.searchParams.get('userId')) {
        const uId = parseInt(url.searchParams.get('userId'), 10);
        accounts = stmts.getImapAccountsByUser.all(uId);
      } else if (user.role === 'admin' && url.searchParams.get('all') === 'true') {
        accounts = stmts.getAllImapAccounts.all();
      } else {
        accounts = stmts.getImapAccountsByUser.all(user.id);
      }
      accounts.forEach(a => {
        a.imap_password = a.imap_password ? '••••••••' : '';
      });
      return json(res, 200, { success: true, accounts });
    } catch (err) {
      console.error('Fetch IMAP accounts error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Add IMAP Account ───────────────────────────────────────────────
  if (url.pathname === '/api/imap-accounts' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const { email, imap_server, imap_port, imap_user, imap_password, userId } = await parseJsonBody(req);
      if (!email || !imap_password) {
        return json(res, 400, { success: false, message: 'Email and password are required.' });
      }

      const targetUserId = (user.role === 'admin' && userId) ? parseInt(userId, 10) : user.id;

      // Limit standard users to a maximum of 2 connected email accounts
      if (user.role !== 'admin') {
        const count = db.prepare(`SELECT COUNT(*) as count FROM imap_accounts WHERE user_id = ?`).get(targetUserId).count;
        if (count >= 2) {
          return json(res, 400, { success: false, message: 'Normal users can only connect up to 2 email accounts.' });
        }
      }

      // Auto-detect server if not specified
      let server = imap_server;
      if (!server) {
        const domain = email.toLowerCase().trim().split('@')[1] || '';
        if (domain === 'gmail.com') {
          server = 'imap.gmail.com';
        } else if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com' || domain === 'office365.com') {
          server = 'outlook.office365.com';
        } else if (domain === 'yahoo.com') {
          server = 'imap.mail.yahoo.com';
        } else {
          server = 'imap.' + domain;
        }
      }

      const port = imap_port ? parseInt(imap_port, 10) : 993;
      const username = imap_user || email;
      const encryptedPass = encrypt(imap_password);
      const createdAt = new Date().toISOString();

      stmts.insertImapAccount.run(targetUserId, email.toLowerCase().trim(), server, port, username, encryptedPass, createdAt);
      return json(res, 201, { success: true, message: 'Connected email account successfully!' });
    } catch (err) {
      console.error('Add IMAP account error:', err);
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return json(res, 409, { success: false, message: 'This email is already connected to this user account.' });
      }
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Update IMAP Account ────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/imap-accounts\/\d+$/) && method === 'PUT') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      const account = stmts.getImapAccountById.get(id);
      if (!account) return json(res, 404, { success: false, message: 'Connected account not found.' });

      if (user.role !== 'admin' && account.user_id !== user.id) {
        return json(res, 403, { success: false, message: 'Access denied.' });
      }

      const { imap_server, imap_user, imap_password } = await parseJsonBody(req);
      const server = imap_server || account.imap_server;
      const username = imap_user || account.imap_user;

      let finalPassword = account.imap_password;
      if (imap_password && !imap_password.startsWith('•••') && imap_password.trim() !== '') {
        finalPassword = encrypt(imap_password);
      }

      stmts.updateImapAccount.run(server, username, finalPassword, id);
      return json(res, 200, { success: true, message: 'Connection settings updated!' });
    } catch (err) {
      console.error('Update IMAP account error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Delete IMAP Account ────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/imap-accounts\/\d+$/) && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      const account = stmts.getImapAccountById.get(id);
      if (!account) return json(res, 404, { success: false, message: 'Connected account not found.' });

      if (user.role !== 'admin' && account.user_id !== user.id) {
        return json(res, 403, { success: false, message: 'Access denied.' });
      }

      if (user.role === 'admin') {
        stmts.deleteImapAccountAdmin.run(id);
      } else {
        stmts.deleteImapAccount.run(id, user.id);
      }
      return json(res, 200, { success: true, message: 'Account disconnected.' });
    } catch (err) {
      console.error('Delete IMAP account error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Export Excel ───────────────────────────────────────────────────
  if (url.pathname === '/api/export' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const emails = user.role === 'admin' ? stmts.getEmails.all() : stmts.getEmailsByUser.all(user.id);
      // Generate CSV (universal, no extra deps)
      let csv = 'ID,Sender,Subject,Priority,Category,Intent,Status,Summary,Draft Reply,Received At,Send At\n';
      emails.forEach(e => {
        const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        csv += [e.id, escape(e.sender), escape(e.subject), e.priority, e.category, escape(e.intent), e.status, escape(e.summary), escape(e.draft_reply), e.received_at, e.send_at || ''].join(',') + '\n';
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="email_export_${Date.now()}.csv"`,
      });
      return res.end(csv);
    } catch (err) {
      return json(res, 500, { success: false, message: 'Export failed.' });
    }
  }

  // ── API: Tasks ──────────────────────────────────────────────────────────
  if (url.pathname === '/api/tasks' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const tasks = stmts.getTasksByUser.all(user.id);
      return json(res, 200, { success: true, tasks });
    } catch (err) {
      console.error('Fetch tasks error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  if (url.pathname === '/api/tasks' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const { title, description, priority, due_date } = await parseJsonBody(req);
      if (!title) return json(res, 400, { success: false, message: 'Title is required.' });
      const createdAt = new Date().toISOString();
      const result = stmts.insertTask.run(
        user.id,
        null, // manual task
        title,
        description || '',
        'To Do',
        priority || 'Medium',
        due_date || null,
        createdAt
      );
      return json(res, 201, { success: true, id: result.lastInsertRowid, message: 'Task created!' });
    } catch (err) {
      console.error('Create task error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  if (url.pathname.match(/^\/api\/tasks\/\d+$/) && method === 'PUT') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      const { title, description, status, priority, due_date } = await parseJsonBody(req);
      stmts.updateTask.run(title || 'Untitled Task', description || '', status || 'To Do', priority || 'Medium', due_date || null, id);
      return json(res, 200, { success: true, message: 'Task updated.' });
    } catch (err) {
      console.error('Update task error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  if (url.pathname.match(/^\/api\/tasks\/\d+$/) && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      stmts.deleteTask.run(id);
      return json(res, 200, { success: true, message: 'Task deleted.' });
    } catch (err) {
      console.error('Delete task error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: AI Composer & Outbound Email ──────────────────────────────────
  if (url.pathname === '/api/generate-email' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const { prompt, tone, length, reference_email } = await parseJsonBody(req);
      if (!prompt) return json(res, 400, { success: false, message: 'Prompt is required.' });

      const db_key_raw = stmts.getSetting.get('gemini_api_key')?.value;
      const db_key = db_key_raw ? decrypt(db_key_raw) : null;
      const env_key = process.env.GEMINI_API_KEY;
      const llm_api_key = db_key && !db_key.startsWith('test-key') && !db_key.startsWith('•••') ? db_key : env_key;

      if (!llm_api_key || llm_api_key === 'your_gemini_api_key_here') {
        return json(res, 400, { success: false, message: 'Gemini API Key is not configured. Please save it in settings.' });
      }

      const systemPrompt = `You are a professional email assistant. Generate a high-quality email draft based on the user's instructions.
Tone: ${tone || 'Professional'}
Length: ${length || 'Medium'}
${reference_email ? `Reference Email (that this responds to or is based on):\n${reference_email}\n` : ''}
Instructions:
${prompt}

Return ONLY the email content (subject line and email body). Do not include any JSON wrapper, markdown code fences, or explanations.`;

      const model = stmts.getSetting.get('gemini_model')?.value || process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llm_api_key}`;
      
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }]
        })
      });

      if (!geminiRes.ok) {
        const errorText = await geminiRes.text();
        return json(res, 502, { success: false, message: `Gemini API returned error: ${errorText}` });
      }

      const geminiData = await geminiRes.json();
      const draft = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return json(res, 200, { success: true, draft });
    } catch (err) {
      console.error('Generate email error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  if (url.pathname === '/api/send-custom-email' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const { recipient, subject, body } = await parseJsonBody(req);
      if (!recipient || !subject || !body) {
        return json(res, 400, { success: false, message: 'Recipient, subject, and body are required.' });
      }

      // Resolve user's mailbox account
      const userAccounts = stmts.getImapAccountsByUser.all(user.id);
      const account = userAccounts && userAccounts.length > 0 ? userAccounts[0] : null;
      const senderUser = stmts.getUserById.get(user.id);

      let smtpServer = 'smtp.gmail.com';
      let smtpUser = (account && account.email) || (senderUser && senderUser.email) || user.email;
      let smtpPass = null;
      let authType = (account && account.auth_type) || 'password';
      let oauthRefreshToken = null;

      if (account) {
        smtpServer = account.imap_server ? account.imap_server.replace('imap.', 'smtp.') : 'smtp.gmail.com';
        if (authType === 'oauth' && account.oauth_refresh_token) {
          oauthRefreshToken = decrypt(account.oauth_refresh_token);
        } else if (account.imap_password) {
          smtpPass = decrypt(account.imap_password);
        }
      } else if (senderUser) {
        if (senderUser.imap_server) smtpServer = senderUser.imap_server.replace('imap.', 'smtp.');
        if (senderUser.imap_user) smtpUser = senderUser.imap_user;
        if (senderUser.imap_password) smtpPass = decrypt(senderUser.imap_password);
      }

      const { spawn } = require('child_process');
      const child = spawn('python', [path.join(__dirname, 'send_email.py')]);
      let stdout = '', stderr = '';

      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });

      child.on('close', code => {
        if (code === 0) {
          // Persist sent email into SQLite DB so it shows in Sent Logs!
          const now = new Date().toISOString();
          try {
            stmts.insertEmail.run(
              user.id,
              recipient,
              subject,
              body,
              now,
              'Medium',
              'Sent',
              'composer',
              'Outbound AI Email',
              `Outbound email dispatched via AI Composer to ${recipient}`,
              JSON.stringify([]),
              body,
              null,
              0,
              account ? account.id : null
            );
          } catch (dbErr) {
            console.error('[Composer DB Log Error]', dbErr.message);
          }
          return json(res, 200, { success: true, message: 'Email sent successfully and recorded in Sent Logs!' });
        } else {
          console.error(`Send custom email SMTP error: ${stderr || stdout}`);
          return json(res, 502, { success: false, message: `SMTP failed: ${stderr || stdout}` });
        }
      });

      const payload = JSON.stringify({
        recipient,
        subject,
        body,
        smtp_server: smtpServer,
        smtp_user: smtpUser,
        smtp_pass: smtpPass,
        auth_type: authType,
        oauth_refresh_token: oauthRefreshToken
      });

      child.stdin.write(payload);
      child.stdin.end();
      return;
    } catch (err) {
      console.error('Send custom email error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── Google OAuth: Initiate ─────────────────────────────────────────────
  if (url.pathname === '/auth/google' && method === 'GET') {
    const sessionToken = url.searchParams.get('token');
    const userId = url.searchParams.get('userId');
    
    const state = Buffer.from(JSON.stringify({ token: sessionToken, userId })).toString('base64');
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(GOOGLE_SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;
    
    res.writeHead(302, { 'Location': authUrl });
    res.end();
    return;
  }

  // ── Google OAuth: Callback ────────────────────────────────────────────
  if (url.pathname === '/auth/google/callback' && method === 'GET') {
    try {
      const code = url.searchParams.get('code');
      const stateRaw = url.searchParams.get('state');
      
      if (!code) {
        res.writeHead(302, { 'Location': '/dashboard.html?oauth_error=no_code' });
        res.end();
        return;
      }
      
      // Parse state to get user info
      let stateData = {};
      try {
        stateData = JSON.parse(Buffer.from(decodeURIComponent(stateRaw), 'base64').toString('utf-8'));
      } catch (e) { /* ignore parse errors */ }
      
      // Verify the session
      const session = stmts.getSession.get(stateData.token);
      if (!session || new Date(session.expires_at) < new Date()) {
        res.writeHead(302, { 'Location': '/?oauth_error=session_expired' });
        res.end();
        return;
      }
      
      const targetUserId = stateData.userId ? parseInt(stateData.userId, 10) : session.user_id;
      
      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code'
        }).toString()
      });
      
      const tokenData = await tokenRes.json();
      
      if (!tokenData.access_token) {
        console.error('OAuth token exchange failed:', tokenData);
        res.writeHead(302, { 'Location': '/dashboard.html?oauth_error=token_failed' });
        res.end();
        return;
      }
      
      // Get user's email from ID token or userinfo
      let userEmail = '';
      if (tokenData.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString('utf-8'));
          userEmail = payload.email || '';
        } catch (e) { /* ignore */ }
      }
      
      if (!userEmail) {
        // Fallback: fetch from userinfo endpoint
        const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const infoData = await infoRes.json();
        userEmail = infoData.email || '';
      }
      
      if (!userEmail) {
        res.writeHead(302, { 'Location': '/dashboard.html?oauth_error=no_email' });
        res.end();
        return;
      }
      
      userEmail = userEmail.toLowerCase().trim();
      const refreshToken = tokenData.refresh_token || '';
      const encryptedRefresh = encrypt(refreshToken);
      const createdAt = new Date().toISOString();
      
      // Check if this email account already exists for this user
      const existing = db.prepare(`SELECT id FROM imap_accounts WHERE user_id = ? AND email = ?`).get(targetUserId, userEmail);
      
      if (existing) {
        // Update existing account with new OAuth tokens
        db.prepare(`UPDATE imap_accounts SET auth_type = 'oauth', oauth_refresh_token = ?, imap_password = '' WHERE id = ?`).run(encryptedRefresh, existing.id);
        console.log(`[OAuth] Updated OAuth tokens for ${userEmail} (account ${existing.id})`);
      } else {
        // Insert new account
        db.prepare(`
          INSERT INTO imap_accounts (user_id, email, imap_server, imap_port, imap_user, imap_password, created_at, auth_type, oauth_refresh_token)
          VALUES (?, ?, 'imap.gmail.com', 993, ?, '', ?, 'oauth', ?)
        `).run(targetUserId, userEmail, userEmail, createdAt, encryptedRefresh);
        console.log(`[OAuth] Connected ${userEmail} via Google OAuth for user ${targetUserId}`);
      }
      
      res.writeHead(302, { 'Location': '/dashboard.html?oauth_success=true' });
      res.end();
      return;
    } catch (err) {
      console.error('OAuth callback error:', err);
      res.writeHead(302, { 'Location': '/dashboard.html?oauth_error=server_error' });
      res.end();
      return;
    }
  }

  // ── API: Clean / Purge Clutter Emails (Overload Solution) ───────────────
  if (url.pathname === '/api/clean-inbox' && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) return json(res, 401, { success: false, message: 'Authentication required.' });
    try {
      const { purgeCategories, olderThanDays } = await parseJsonBody(req);
      const categories = Array.isArray(purgeCategories) && purgeCategories.length > 0 
        ? purgeCategories 
        : ['spam', 'promotion', 'newsletter'];
      
      const placeholders = categories.map(() => '?').join(',');
      let query = `DELETE FROM emails WHERE category IN (${placeholders})`;
      const params = [...categories];

      if (user.role !== 'admin') {
        query += ` AND user_id = ?`;
        params.push(user.id);
      }

      if (olderThanDays && parseInt(olderThanDays, 10) > 0) {
        const cutoffDate = new Date(Date.now() - parseInt(olderThanDays, 10) * 24 * 60 * 60 * 1000).toISOString();
        query += ` AND received_at < ?`;
        params.push(cutoffDate);
      }

      const result = db.prepare(query).run(...params);
      return json(res, 200, {
        success: true,
        message: `Successfully purged ${result.changes} junk/clutter email(s)!`,
        count: result.changes
      });
    } catch (err) {
      console.error('Clean inbox error:', err);
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── Static File Serving ─────────────────────────────────────────────────
  if (method === 'GET') {
    const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
    let filePath = '';

    if (url.pathname === '/' || url.pathname === '/index.html') {
      filePath = path.join(FRONTEND_DIR, 'index.html');
    } else if (url.pathname === '/dashboard.html' || url.pathname === '/dashboard') {
      filePath = path.join(FRONTEND_DIR, 'dashboard.html');
    } else if (url.pathname === '/admin.html' || url.pathname === '/admin') {
      filePath = path.join(FRONTEND_DIR, 'admin.html');
    } else {
      // Map /css/style.css → frontend/css/style.css, /js/app.js → frontend/js/app.js
      const safePath = url.pathname.replace(/\.\./g, '');
      filePath = path.join(FRONTEND_DIR, safePath);
    }

    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const contentType = MIME[ext] || 'application/octet-stream';
      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Server Error');
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  // ── Fallback ────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, message: 'Not found.' }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

module.exports = server;
