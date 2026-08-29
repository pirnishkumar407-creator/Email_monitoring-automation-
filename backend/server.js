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
      // Spawn send_email.py
      const { spawn } = require('child_process');
      const child = spawn('python', [path.join(__dirname, 'send_email.py')]);
      const payload = JSON.stringify({
        recipient: email.sender,
        subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
        body: email.draft_reply,
        smtp_server: smtpServer,
        smtp_user: smtpUser,
        smtp_pass: smtpPass
      });
      child.stdin.write(payload);
      child.stdin.end();
      child.on('close', (code) => {
        if (code === 0) {
          stmts.updateEmailStatus.run('Auto-Sent', email.id);
          console.log(`[Auto-Send] Email ${email.id} auto-sent to ${email.sender}`);
        } else {
          console.error(`[Auto-Send] Failed to send email ${email.id}`);
        }
      });
    }
  } catch (err) {
    console.error('[Auto-Send Error]', err.message);
  }
}

// Check every 60 seconds
setInterval(checkAutoSend, 60000);

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
      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
      const hasSpace = /\s/.test(password);
      if (password.length < 9 || password.length > 10 || !hasUpper || !hasLower || !hasSpecial || hasSpace) {
        return json(res, 400, {
          success: false,
          message: 'Password must be 9-10 characters long, and contain at least one uppercase letter, one lowercase letter, one special character, and no spaces.'
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
      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
      const hasSpace = /\s/.test(password);
      if (password.length < 9 || password.length > 10 || !hasUpper || !hasLower || !hasSpecial || hasSpace) {
        return json(res, 400, {
          success: false,
          message: 'Password must be 9-10 characters long, and contain at least one uppercase letter, one lowercase letter, one special character, and no spaces.'
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


  // ── API: Get All Users (Admin only) ─────────────────────────────────────
  if (url.pathname === '/api/users' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const users = stmts.getAllUsers.all();
      return json(res, 200, { success: true, users });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
    }
  }

  // ── API: Delete User (Admin only) ───────────────────────────────────────
  if (url.pathname.match(/^\/api\/users\/\d+$/) && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { success: false, message: 'Admin access required.' });
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      stmts.deleteUser.run(id);
      return json(res, 200, { success: true, message: 'User deleted.' });
    } catch (err) {
      return json(res, 500, { success: false, message: 'Internal server error.' });
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
      const args = [];
      if (!hasImap) {
        args.push('--simulate');
      }

      const child = spawn('python', [path.join(__dirname, 'agent.py'), ...args]);
      let stdout = '', stderr = '';
      
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });

      child.on('close', code => {
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
      return;
    } catch (err) {
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
        smtp_pass: smtpPass
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

      if (user.role === 'admin') {
        Object.keys(s).forEach(k => {
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
      return json(res, 200, { success: true, message: 'Settings saved!' });
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
      if (!imap_server || !imap_user) {
        return json(res, 400, { success: false, message: 'Server and username are required.' });
      }

      let finalPassword = account.imap_password;
      if (imap_password && !imap_password.startsWith('•••')) {
        finalPassword = encrypt(imap_password);
      }

      stmts.updateImapAccount.run(imap_server, imap_user, finalPassword, id);
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
      stmts.updateTask.run(title, description, status, priority, due_date, id);
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

      const senderUser = stmts.getUserById.get(user.id);
      const { spawn } = require('child_process');
      const child = spawn('python', [path.join(__dirname, 'send_email.py')]);
      let stdout = '', stderr = '';

      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });

      child.on('close', code => {
        if (code === 0) {
          return json(res, 200, { success: true, message: 'Email sent successfully!' });
        } else {
          console.error(`Send custom email SMTP error: ${stderr || stdout}`);
          return json(res, 502, { success: false, message: `SMTP failed: ${stderr || stdout}` });
        }
      });

      const payload = JSON.stringify({
        recipient,
        subject,
        body,
        smtp_server: senderUser ? senderUser.imap_server : null,
        smtp_user: senderUser ? senderUser.imap_user : null,
        smtp_pass: senderUser && senderUser.imap_password ? decrypt(senderUser.imap_password) : null
      });

      child.stdin.write(payload);
      child.stdin.end();
      return;
    } catch (err) {
      console.error('Send custom email error:', err);
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

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
