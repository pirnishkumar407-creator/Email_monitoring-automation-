// backend/db.js — Centralized SQLite Database Schema & Helpers
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const isVercel = Boolean(process.env.VERCEL);
const DB_FILE = isVercel
  ? path.join('/tmp', 'users.db')
  : path.join(__dirname, '..', 'users.db');

// On Vercel, copy bundled database to /tmp if not yet present
if (isVercel && !fs.existsSync(DB_FILE)) {
  const bundled = path.join(__dirname, '..', 'users.db');
  if (fs.existsSync(bundled)) {
    try {
      fs.copyFileSync(bundled, DB_FILE);
      console.log('[DB] Seeded /tmp/users.db from bundled database');
    } catch (err) {
      console.error('[DB] Failed copying bundled database:', err.message);
    }
  }
}

// Load .env for admin auto-creation
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        env[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
      }
    }
  }
  return env;
}

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_IV_LEN = 16;

function getEncryptionKey() {
  const env = loadEnv();
  let key = process.env.ENCRYPTION_KEY || env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!key) {
    key = '4f8a9e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f';
    if (!isVercel) {
      const envPath = path.join(__dirname, '..', '.env');
      try {
        fs.appendFileSync(envPath, `\nENCRYPTION_KEY=${key}\n`);
      } catch (_) {}
    }
  }
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }
  return crypto.createHash('sha256').update(key).digest();
}

function encrypt(text) {
  if (!text) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(ENCRYPTION_IV_LEN);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text) return '';
  try {
    const parts = text.split(':');
    if (parts.length !== 2) return text;
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    if (iv.length !== ENCRYPTION_IV_LEN) return text;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return text;
  }
}

// Initialize SQLite database
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    imap_server TEXT,
    imap_user TEXT,
    imap_password TEXT,
    reset_token TEXT,
    created_at TEXT NOT NULL
  )
`);

try {
  db.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT`);
} catch (e) {
  // Column likely already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS imap_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    imap_server TEXT NOT NULL,
    imap_port INTEGER DEFAULT 993,
    imap_user TEXT NOT NULL,
    imap_password TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, email)
  )
`);

// Migration: Add OAuth columns
try {
  db.exec(`ALTER TABLE imap_accounts ADD COLUMN auth_type TEXT DEFAULT 'password'`);
} catch (e) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE imap_accounts ADD COLUMN oauth_refresh_token TEXT`);
} catch (e) { /* Column already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    sender TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    received_at TEXT NOT NULL,
    priority TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'Pending',
    category TEXT DEFAULT 'important',
    intent TEXT,
    summary TEXT,
    action_items TEXT,
    draft_reply TEXT,
    send_at TEXT,
    edited_at TEXT,
    requires_approval INTEGER DEFAULT 0,
    imap_account_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (imap_account_id) REFERENCES imap_accounts(id) ON DELETE SET NULL
  )
`);

try {
  db.exec(`ALTER TABLE emails ADD COLUMN imap_account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL`);
} catch (e) {
  // Column already exists
}

// Migration: Move legacy user IMAP settings to imap_accounts
try {
  const legacyUsers = db.prepare(`SELECT id, email, imap_server, imap_user, imap_password, created_at FROM users WHERE imap_server IS NOT NULL AND imap_server != ''`).all();
  for (const u of legacyUsers) {
    const existing = db.prepare(`SELECT id FROM imap_accounts WHERE user_id = ? AND email = ?`).get(u.id, u.email);
    if (!existing) {
      db.prepare(`
        INSERT INTO imap_accounts (user_id, email, imap_server, imap_port, imap_user, imap_password, created_at)
        VALUES (?, ?, ?, 993, ?, ?, ?)
      `).run(u.id, u.email, u.imap_server, u.imap_user, u.imap_password, u.created_at || new Date().toISOString());
      console.log(`[Migration] Migrated legacy IMAP configuration for user ${u.email} to imap_accounts`);
    }
  }
} catch (err) {
  console.error('[Migration Error]', err.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    email_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'To Do',
    priority TEXT DEFAULT 'Medium',
    due_date TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// ── Password Helpers ────────────────────────────────────────────────────────

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function createUser(email, password, role = 'user', imapServer = '', imapUser = '', imapPassword = '') {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const encryptedPassword = imapPassword ? encrypt(imapPassword) : '';
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (email, password_hash, salt, role, imap_server, imap_user, imap_password, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(email.toLowerCase().trim(), hash, salt, role, imapServer, imapUser, encryptedPassword, createdAt);
}

// ── Admin Auto-Creation ─────────────────────────────────────────────────────

function ensureAdmin() {
  const env = loadEnv();
  const adminEmail = (env.IMAP_USER || '').toLowerCase().trim();
  if (!adminEmail) return;

  const existing = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).get();
  if (!existing) {
    try {
      const securePassword = (process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || 'Admin@123456').trim();
      createUser(adminEmail, securePassword, 'admin', env.IMAP_SERVER || 'imap.gmail.com', env.IMAP_USER || '', env.IMAP_PASSWORD || '');
      console.log(`[DB] Admin account created: ${adminEmail}`);
    } catch (e) {
      // Already exists, promote to admin
      db.prepare(`UPDATE users SET role = 'admin' WHERE email = ?`).run(adminEmail);
      console.log(`[DB] Promoted existing user to admin: ${adminEmail}`);
    }
  }
}

ensureAdmin();

// ── Prepared Statements ─────────────────────────────────────────────────────

const stmts = {
  // Users
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById: db.prepare(`SELECT id, email, role, imap_server, imap_user, imap_password, created_at FROM users WHERE id = ?`),
  getAllUsers: db.prepare(`SELECT id, email, role, created_at FROM users ORDER BY created_at DESC`),
  getAllUsersDetailed: db.prepare(`
    SELECT 
      u.id, 
      u.email, 
      u.role, 
      u.created_at,
      (SELECT COUNT(*) FROM imap_accounts WHERE user_id = u.id) as mailbox_count,
      (SELECT COUNT(*) FROM emails WHERE user_id = u.id) as email_count
    FROM users u 
    ORDER BY u.created_at DESC
  `),
  countAdmins: db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`),
  updateUserRole: db.prepare(`UPDATE users SET role = ? WHERE id = ?`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id = ? AND role != 'admin'`),
  deleteUserAny: db.prepare(`DELETE FROM users WHERE id = ?`),
  updateUserImap: db.prepare(`UPDATE users SET imap_server = ?, imap_user = ?, imap_password = ? WHERE id = ?`),
  updateUserResetToken: db.prepare(`UPDATE users SET reset_token = ? WHERE id = ?`),
  updateUserPassword: db.prepare(`UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL WHERE id = ?`),

  // IMAP Accounts
  getImapAccountsByUser: db.prepare(`SELECT id, user_id, email, imap_server, imap_port, imap_user, imap_password, auth_type, created_at FROM imap_accounts WHERE user_id = ?`),
  getImapAccountById: db.prepare(`SELECT * FROM imap_accounts WHERE id = ?`),
  getAllImapAccounts: db.prepare(`SELECT * FROM imap_accounts ORDER BY created_at DESC`),
  getAllMailboxesDetailed: db.prepare(`
    SELECT 
      a.id, 
      a.user_id, 
      a.email, 
      a.imap_server, 
      a.imap_port, 
      a.imap_user, 
      a.auth_type, 
      a.created_at,
      u.email as user_email
    FROM imap_accounts a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
  `),
  insertImapAccount: db.prepare(`INSERT INTO imap_accounts (user_id, email, imap_server, imap_port, imap_user, imap_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  updateImapAccount: db.prepare(`UPDATE imap_accounts SET imap_server = ?, imap_user = ?, imap_password = ? WHERE id = ?`),
  deleteImapAccount: db.prepare(`DELETE FROM imap_accounts WHERE id = ? AND user_id = ?`),
  deleteImapAccountAdmin: db.prepare(`DELETE FROM imap_accounts WHERE id = ?`),

  // Emails
  insertEmail: db.prepare(`
    INSERT INTO emails (user_id, sender, subject, body, received_at, priority, status, category, intent, summary, action_items, draft_reply, send_at, requires_approval, imap_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getEmails: db.prepare(`SELECT id, user_id, sender, subject, received_at, priority, status, category, intent, summary, action_items, draft_reply, send_at, requires_approval, imap_account_id FROM emails ORDER BY received_at DESC`),
  getEmailsByUser: db.prepare(`SELECT id, user_id, sender, subject, received_at, priority, status, category, intent, summary, action_items, draft_reply, send_at, requires_approval, imap_account_id FROM emails WHERE user_id = ? ORDER BY received_at DESC`),
  getEmailById: db.prepare(`SELECT * FROM emails WHERE id = ?`),
  updateEmailStatus: db.prepare(`UPDATE emails SET status = ? WHERE id = ?`),
  updateEmailDraft: db.prepare(`UPDATE emails SET draft_reply = ?, status = 'Pending', edited_at = ?, send_at = ? WHERE id = ?`),
  deleteEmailByUser: db.prepare(`DELETE FROM emails WHERE id = ? AND user_id = ?`),
  deleteEmailAdmin: db.prepare(`DELETE FROM emails WHERE id = ?`),
  deleteTasksByEmail: db.prepare(`DELETE FROM tasks WHERE email_id = ?`),
  getPendingAutoSend: db.prepare(`SELECT * FROM emails WHERE status = 'Pending' AND send_at IS NOT NULL AND send_at <= ?`),

  getStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN priority = 'High' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN status = 'Pending' AND draft_reply IS NOT NULL AND TRIM(draft_reply) != '' THEN 1 ELSE 0 END) as drafted,
      SUM(CASE WHEN status IN ('Sent', 'Auto-Sent', 'Approved') THEN 1 ELSE 0 END) as sent
    FROM emails
  `),
  getAdminOverview: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'admin') as total_admins,
      (SELECT COUNT(*) FROM imap_accounts) as total_mailboxes,
      (SELECT COUNT(*) FROM emails) as total_emails,
      (SELECT COUNT(*) FROM emails WHERE status IN ('Sent', 'Auto-Sent', 'Approved')) as total_sent,
      (SELECT COUNT(*) FROM emails WHERE status = 'Pending' AND draft_reply IS NOT NULL AND TRIM(draft_reply) != '') as total_drafts,
      (SELECT COUNT(*) FROM tasks) as total_tasks,
      (SELECT COUNT(*) FROM sessions) as active_sessions
  `),

  getStatsByUser: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN priority = 'High' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN status = 'Pending' AND draft_reply IS NOT NULL AND TRIM(draft_reply) != '' THEN 1 ELSE 0 END) as drafted,
      SUM(CASE WHEN status IN ('Sent', 'Auto-Sent', 'Approved') THEN 1 ELSE 0 END) as sent
    FROM emails WHERE user_id = ?
  `),

  // Analytics
  getEmailsByDay: db.prepare(`
    SELECT DATE(received_at) as day, COUNT(*) as count
    FROM emails
    GROUP BY DATE(received_at)
    ORDER BY day DESC
    LIMIT 7
  `),
  getEmailsByCategory: db.prepare(`
    SELECT category, COUNT(*) as count FROM emails GROUP BY category
  `),
  getEmailsByPriority: db.prepare(`
    SELECT priority, COUNT(*) as count FROM emails GROUP BY priority
  `),
  getResponseRate: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('Sent', 'Auto-Sent', 'Approved') THEN 1 ELSE 0 END) as responded
    FROM emails
  `),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`),

  // Tasks
  getTasksByUser: db.prepare(`
    SELECT tasks.*, emails.subject as email_subject, emails.sender as email_sender 
    FROM tasks 
    LEFT JOIN emails ON tasks.email_id = emails.id 
    WHERE tasks.user_id = ? 
    ORDER BY tasks.created_at DESC
  `),
  insertTask: db.prepare(`
    INSERT INTO tasks (user_id, email_id, title, description, status, priority, due_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateTaskStatus: db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`),
  updateTask: db.prepare(`
    UPDATE tasks 
    SET title = ?, description = ?, status = ?, priority = ?, due_date = ? 
    WHERE id = ?
  `),
  deleteTask: db.prepare(`DELETE FROM tasks WHERE id = ?`),

  // Sessions
  insertSession: db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`),
  createSession: db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
  deleteExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at < ?`),
};

module.exports = { db, stmts, hashPassword, createUser, loadEnv, DB_FILE, encrypt, decrypt };
