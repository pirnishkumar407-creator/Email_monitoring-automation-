# AI Email Automation & Monitoring System — Complete Architecture & Codebase Guide

> **Document Purpose**: This is the exhaustive, end-to-end architectural, algorithmic, and code reference for the **AI Email Automation System**. Any AI language model, software architect, or software engineer can read this single document to gain full, precise understanding of every file, function, database schema, background process, and user interface workflow in this repository.

---

## Table of Contents
1. [Executive Summary & Core Value Proposition](#1-executive-summary--core-value-proposition)
2. [System Architecture & Technology Stack](#2-system-architecture--technology-stack)
3. [Repository Directory & File Map](#3-repository-directory--file-map)
4. [Database Schema & Data Models (SQLite WAL)](#4-database-schema--data-models-sqlite-wal)
5. [Cryptographic Security & Token Specifications](#5-cryptographic-security--token-specifications)
6. [Authentication, Sessions & Google OAuth2 Flow](#6-authentication-sessions--google-oauth2-flow)
7. [Email Ingestion & AI Classification Engine (`agent.py`)](#7-email-ingestion--ai-classification-engine-agentpy)
8. [Background Daemons & Automation Engine (`server.js`)](#8-background-daemons--automation-engine-serverjs)
9. [Outbound Email Dispatcher (`send_email.py`)](#9-outbound-email-dispatcher-send_emailpy)
10. [Frontend Single-Page Application (SPA) Architecture](#10-frontend-single-page-application-spa-architecture)
11. [Complete REST API Specification](#11-complete-rest-api-specification)
12. [Environment Configuration (`.env`)](#12-environment-configuration-env)
13. [Deployment, Execution & Operational Guide](#13-deployment-execution--operational-guide)

---

## 1. Executive Summary & Core Value Proposition

The **AI Email Automation System** is an enterprise-grade, multi-tenant autonomous email assistant and inbox monitor. It bridges user mailboxes (Gmail via OAuth2 or standard IMAP/SMTP) with **Google Gemini AI** to automatically:
1. **Monitor Inboxes in Real-Time**: Periodically checks for new and unread emails via background daemons without requiring manual page reloads.
2. **Classify & Prioritize Emails**: Analyzes incoming messages for Priority (`High`, `Medium`, `Low`), Category (`important`, `newsletter`, `promotion`, `spam`), Intent, and Summary.
3. **Extract Actionable Tasks**: Detects explicit commitments, questions, action items, and deadlines, automatically storing them in a task tracker.
4. **Draft High-Quality Contextual Replies**: Automatically generates professional reply drafts tailored to message tone and intent.
5. **Execute Automated or Human-in-the-Loop Dispatches**:
   * Auto-sends routine low-risk replies after a user-configured countdown timer (e.g., 20 minutes) with a live ticking countdown.
   * Holds high-stakes or sensitive emails for explicit human approval (`requires_approval = 1`).
6. **AI Composer for Outbound Mail**: Allows users to prompt Gemini with desired intent and tone (Professional, Friendly, Direct, Casual, Sales), edit the generated draft, and dispatch it directly through their connected mailbox with full persistence in Sent Logs.
7. **Audit & Analytics**: Tracks historical sent logs, category distribution, daily volume, and response rates through Canvas-based analytics and Excel log exports.

---

## 2. System Architecture & Technology Stack

```
+---------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER                                     |
|  Vanilla JS SPA (app.js, charts.js, auth.js) + HTML5 + CSS3 (Dark/Bright Mode)       |
+-------------------------------------------+-------------------------------------------+
                                            | HTTP REST API / Session Bearer Auth
                                            v
+---------------------------------------------------------------------------------------+
|                                NODE.JS BACKEND (server.js)                            |
|  - Node.js Native HTTP Server (zero heavy framework dependencies)                     |
|  - SQLite (node:sqlite DatabaseSync) with WAL Mode                                    |
|  - AES-256-CBC Secret Encryption & PBKDF2-SHA512 Password Hasher                     |
|  - Google OAuth2 Token Handler & Flow Orchestrator                                    |
|  - Background Daemon Timers:                                                          |
|      * 60s Auto-Sync Ingestion Loop (spawns agent.py)                                 |
|      * 60s Auto-Send Dispatcher Loop (spawns send_email.py)                           |
+-------------------+-----------------------------------------------+-------------------+
                    |                                               |
       Spawns Subprocess                               Spawns Subprocess
                    v                                               v
+---------------------------------------+   +-------------------------------------------+
|          PYTHON AGENT ENGINE          |   |           PYTHON DISPATCH ENGINE          |
|              (agent.py)               |   |              (send_email.py)              |
|  - IMAPClient (SSL 993) / XOAUTH2     |   |  - smtplib.SMTP_SSL (Port 465)            |
|  - RFC 2047 MIME Header Decoder       |   |  - Google XOAUTH2 & Password Auth         |
|  - UNSEEN + SINCE Today Ingestion     |   |  - Outbound Draft & Composer Dispatch     |
|  - Gemini 1.5 API Structured Client   |   |  - Simulation Fallback Mode               |
|  - Heuristic Fallback Classifier      |   +-------------------------------------------+
|  - Excel Audit Logger (openpyxl)      |
+-------------------+-------------------+
                    |
                    v
+---------------------------------------+
|           EXTERNAL SERVICES           |
|  - Google Cloud OAuth2 API            |
|  - Google Gemini Generative AI API    |
|  - IMAP Servers (imap.gmail.com)      |
|  - SMTP Servers (smtp.gmail.com)      |
+---------------------------------------+
```

### Stack Components
* **Runtime**: Node.js v18+ (utilizing Node's native `node:sqlite` `DatabaseSync`, `crypto`, `child_process`, and `http` modules).
* **Python Runtime**: Python 3.10+ (utilizing `imapclient`, `google-genai` / `urllib`, `openpyxl`, `smtplib`).
* **Database**: SQLite 3 database (`users.db`) with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) for concurrent reading and writing between Node.js and Python.
* **Frontend**: Vanilla JavaScript (ES6+), Vanilla CSS3 with CSS custom properties (Variables), Glassmorphism, CSS keyframe animations, and custom HTML5 Canvas charts.

---

## 3. Repository Directory & File Map

```
.
├── .env                               # Environment variables (API keys, ports, secrets)
├── .gitignore                         # Git exclusion rules
├── README.md                          # Project introduction and quickstart
├── project_documentation.md           # High-level architecture documentation
├── requirements.txt                   # Python dependencies (imapclient, google-genai, openpyxl)
├── run.bat                            # Windows batch launcher
├── run.ps1                            # Windows PowerShell launch script
├── run.sh                             # Linux/macOS bash launcher
├── users.db                           # Primary SQLite database (generated at runtime)
│
├── backend/
│   ├── agent.py                       # Python IMAP Ingestion & Gemini AI Intelligence Agent
│   ├── db.js                          # Node.js SQLite initialization, prepared statements, crypt helpers
│   ├── send_email.py                  # Python SMTP SSL / XOAUTH2 outbound email dispatcher
│   ├── server.js                      # Core Node.js HTTP web server, REST API, daemon loops
│   └── data/
│       └── email_log.xlsx             # Openpyxl Excel audit log of processed emails
│
└── frontend/
    ├── index.html                     # Login, Registration & Password Reset Portal
    ├── dashboard.html                 # Main App SPA: Inbox, Drafts, Sent Logs, Composer, Analytics, Settings
    ├── admin.html                     # Admin Center: User management, mailbox health, AI tester
    ├── css/
    │   └── style.css                  # Global responsive stylesheet (Dark/Bright themes, components)
    └── js/
        ├── app.js                     # Dashboard SPA controller (routing, state, rendering, API calls)
        ├── auth.js                    # Login, signup, password reset form handlers
        ├── admin.js                   # Admin dashboard controller (metrics, users, mailboxes)
        └── charts.js                  # HTML5 Canvas chart renderer (Bar, Donut, Line, Gauge)
```

---

## 4. Database Schema & Data Models (SQLite WAL)

Database file: `users.db`. Initialized in `backend/db.js` via `node:sqlite`. Concurrency is managed via:
```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

### 4.1 Table: `users`
Stores user account profiles and application roles.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique user identifier |
| `email` | TEXT | UNIQUE NOT NULL | Normalized lowercase user email address |
| `password_hash` | TEXT | NOT NULL | PBKDF2-SHA512 derived password hex digest |
| `salt` | TEXT | NOT NULL | 16-byte random hex salt |
| `role` | TEXT | DEFAULT 'user' | Access tier: `'admin'` or `'user'` |
| `imap_server` | TEXT | NULL | Legacy/fallback IMAP server address |
| `imap_user` | TEXT | NULL | Legacy/fallback IMAP username |
| `imap_password` | TEXT | NULL | Legacy/fallback AES-256-CBC encrypted IMAP password |
| `reset_token` | TEXT | NULL | JSON string with OTP hash and expiration for password recovery |
| `created_at` | TEXT | NOT NULL | ISO-8601 creation timestamp |

### 4.2 Table: `imap_accounts`
Enables multi-mailbox connectivity per user (supports password auth and Google OAuth2).
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique mailbox identifier |
| `user_id` | INTEGER | NOT NULL, FK -> users(id) ON DELETE CASCADE | Associated user |
| `email` | TEXT | NOT NULL | Mailbox email address |
| `imap_server` | TEXT | NOT NULL | IMAP host (e.g. `imap.gmail.com`) |
| `imap_port` | INTEGER | DEFAULT 993 | IMAP SSL port |
| `imap_user` | TEXT | NOT NULL | Authentication username / email |
| `imap_password` | TEXT | NOT NULL | AES-256-CBC encrypted password (or empty for OAuth) |
| `auth_type` | TEXT | DEFAULT 'password' | `'password'` or `'oauth'` |
| `oauth_refresh_token`| TEXT | NULL | AES-256-CBC encrypted Google OAuth2 refresh token |
| `created_at` | TEXT | NOT NULL | ISO-8601 creation timestamp |
*Unique Constraint*: `UNIQUE(user_id, email)`.

### 4.3 Table: `emails`
Core entity storing incoming processed messages, AI classifications, and reply drafts.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique email record ID |
| `user_id` | INTEGER | DEFAULT 1, FK -> users(id) | Mailbox owner |
| `sender` | TEXT | NOT NULL | Originator email address (or recipient for outbound Composer mail) |
| `subject` | TEXT | NULL | Clean decoded RFC 2047 subject |
| `body` | TEXT | NULL | Clean text content (HTML stripped) |
| `received_at` | TEXT | NOT NULL | ISO-8601 arrival/dispatch timestamp |
| `priority` | TEXT | DEFAULT 'Medium' | Classification: `'High'`, `'Medium'`, `'Low'` |
| `status` | TEXT | DEFAULT 'Pending' | Lifecycle state: `'Pending'`, `'Sent'`, `'Auto-Sent'`, `'Approved'`, `'Failed'` |
| `category` | TEXT | DEFAULT 'important'| Category: `'important'`, `'newsletter'`, `'promotion'`, `'spam'`, `'composer'` |
| `intent` | TEXT | NULL | AI-extracted purpose (e.g. `"Interview Invitation"`, `"Billing Inquiry"`) |
| `summary` | TEXT | NULL | Concise 1-2 sentence AI summary |
| `action_items` | TEXT | NULL | JSON string array of actionable tasks |
| `draft_reply` | TEXT | NULL | AI-generated or user-edited reply text |
| `send_at` | TEXT | NULL | Scheduled ISO-8601 auto-send timestamp |
| `edited_at` | TEXT | NULL | Timestamp of manual draft edit |
| `requires_approval` | INTEGER | DEFAULT 0 | `1` if email requires human review; `0` if auto-dispatchable |
| `imap_account_id` | INTEGER | NULL, FK -> imap_accounts(id) | Associated account |

### 4.4 Table: `tasks`
Extracted action items from emails, usable as a lightweight Kanban task manager.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Task identifier |
| `user_id` | INTEGER | DEFAULT 1, FK -> users(id) | Task owner |
| `email_id` | INTEGER | NULL, FK -> emails(id) ON DELETE SET NULL | Originating email |
| `title` | TEXT | NOT NULL | Short action item description |
| `description` | TEXT | NULL | Additional context |
| `status` | TEXT | DEFAULT 'To Do' | Kanban status: `'To Do'`, `'In Progress'`, `'Completed'` |
| `priority` | TEXT | DEFAULT 'Medium' | Task priority |
| `due_date` | TEXT | NULL | Optional ISO deadline |
| `created_at` | TEXT | NOT NULL | ISO-8601 timestamp |

### 4.5 Table: `sessions`
Lightweight persistent session store for bearer authentication tokens.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 32-byte cryptographically secure hex session token |
| `user_id` | INTEGER | NOT NULL, FK -> users(id) ON DELETE CASCADE | Authenticated user |
| `expires_at` | TEXT | NOT NULL | ISO-8601 expiration (7 days from issue) |

### 4.6 Table: `settings`
Key-value configuration store for application settings (e.g. `ruleAutoSendDelay`, `geminiApiKey`).
| Column | Type | Constraints | Description |
|---|---|---|---|
| `key` | TEXT | PRIMARY KEY | Setting identifier |
| `value` | TEXT | NULL | Serialized setting value |

---

## 5. Cryptographic Security & Token Specifications

### 5.1 Symmetric Secret Encryption (AES-256-CBC)
All stored sensitive secrets (mail passwords, OAuth refresh tokens) are encrypted before insertion into SQLite using `AES-256-CBC`:
* **Key Derivation**: SHA-256 hash of `process.env.ENCRYPTION_SECRET` (or `SESSION_SECRET` fallback).
* **IV Generation**: 16 cryptographically random bytes via `crypto.randomBytes(16)`.
* **Storage Format**: Hex-encoded string formatted as `"<iv_hex>:<ciphertext_hex>"`.
* **Decryption**: Splits by `:`; validates IV length (16 bytes); decipher streams into UTF-8.

### 5.2 Password Hashing
* **Algorithm**: PBKDF2 with HMAC-SHA512.
* **Iterations**: 10,000 iterations.
* **Key Length**: 64 bytes (128 hex characters).
* **Salt**: 16 cryptographically random bytes generated per user.

### 5.3 Password Recovery OTP Security
* **Format**: 6-digit cryptographic integer (`100000` to `999999`).
* **Storage**: Hashed via SHA-256 before storage in `users.reset_token`. Raw token is never stored in plaintext.
* **Expiration**: 15 minutes from issue.

---

## 6. Authentication, Sessions & Google OAuth2 Flow

### 6.1 Traditional Email & Password Flow
1. **Signup** (`POST /api/signup`): Validates email syntax and password length (min 8 chars); hashes password with fresh salt; auto-creates user record; auto-configures default IMAP connection if `IMAP_USER` matches.
2. **Login** (`POST /api/login`): Verifies password using PBKDF2-SHA512; generates 32-byte random hex token; saves session to `sessions` table (7-day validity); returns token and user profile.
3. **Session Middleware** (`getAuthUser(req)`): Extracts `Authorization: Bearer <token>`; automatically purges expired sessions (`expires_at < now`); returns user object or `null`.

### 6.2 Google OAuth2 Authorization Code Flow
Enables 1-click Gmail connectivity without requiring Google App Passwords:
```
[User clicks 'Connect with Google']
           |
           v
GET /auth/google?token=<session_token>&userId=<id>
           |
           +--> Server constructs Google Auth URL with scopes:
           |    - https://mail.google.com/ (Full IMAP/SMTP access)
           |    - https://www.googleapis.com/auth/userinfo.email
           |    - https://www.googleapis.com/auth/userinfo.profile
           |    - openid
           |    State: Base64({ token, userId })
           |
           v
[User authorizes on accounts.google.com]
           |
           v
GET /auth/google/callback?code=<code>&state=<state>
           |
           +--> Exchanges <code> with https://oauth2.googleapis.com/token
           +--> Obtains access_token & refresh_token
           +--> Fetches user profile from https://www.googleapis.com/oauth2/v2/userinfo
           +--> Encrypts refresh_token using AES-256-CBC
           +--> Upserts mailbox into `imap_accounts` (auth_type = 'oauth')
           |
           v
Redirects user browser to /dashboard.html?google_auth=success
```

---

## 7. Email Ingestion & AI Classification Engine (`agent.py`)

The ingestion engine is written in Python (`backend/agent.py`) and executed as an autonomous subprocess or CLI tool:
```bash
python backend/agent.py [--user-id <id>] [--simulate]
```

### 7.1 Multi-User Sync Dispatching
* When run without arguments, `agent.py` checks all configured mailboxes in `imap_accounts` across all users.
* When `--user-id <id>` is provided, it isolates sync to that specific user's mailboxes.

### 7.2 Connection & Authentication
* **Password Mode**: Connects via `IMAPClient(imap_server, ssl=True, port=993)`; executes `client.login(imap_user, password)`.
* **OAuth2 Mode**: Decrypts `oauth_refresh_token`; POSTs to `https://oauth2.googleapis.com/token` to exchange for a fresh short-lived `access_token`; executes standard XOAUTH2 authentication:
  ```python
  client.oauth2_login(imap_user, access_token)
  ```

### 7.3 Dual Search Strategy (Eliminates Mobile Read Desync)
Previously, looking only for `UNSEEN` emails caused messages already read on mobile devices to be ignored forever. `agent.py` solves this via a **dual-search merge strategy**:
```python
today_str = date.today().strftime('%d-%b-%Y')
unseen_messages = client.search('UNSEEN')
today_messages = client.search(['SINCE', today_str])

# Combine unique message IDs, sorted newest last
combined = list(set(list(unseen_messages) + list(today_messages)))
combined.sort()
if len(combined) > 15:
    combined = combined[-15:]
```
Every email received today is scanned, but duplicates are cleanly skipped if already present in SQLite.

### 7.4 MIME Parsing & RFC 2047 Subject Decoding
* **Subject Decoding**: Encoded MIME headers (e.g. `=?UTF-8?B?...?=`) are decoded using Python's `email.header.decode_header()` into clean human-readable strings.
* **Body Extraction**: Walks multipart trees; prioritizes `text/plain`; falls back to stripping HTML tags from `text/html` via regex.

### 7.5 Gemini AI Prompting & Output Schema
When `GEMINI_API_KEY` is present, `agent.py` prompts Gemini (`gemini-1.5-flash` or `gemini-1.5-pro`):
```json
{
  "priority": "High | Medium | Low",
  "category": "important | newsletter | promotion | spam",
  "intent": "Brief string indicating purpose",
  "summary": "1-2 sentence high-level summary",
  "action_items": ["Action item 1", "Action item 2"],
  "draft_reply": "Professional, courteous response ready to send",
  "requires_approval": true | false
}
```
* **Guardrail**: If the email is marketing, spam, or a generic notification, `draft_reply` is set to empty and `requires_approval` is set to `false`.

### 7.6 Heuristic Fallback Classifier
If the Gemini API key is missing, invalid, or hits quota limits, `agent.py` automatically falls back to an offline rule-based heuristic classifier:
* Detects urgent keywords (`urgent`, `critical`, `server down`, `asap`) -> `priority = "High"`.
* Detects newsletters (`unsubscribe`, `digest`) -> `category = "newsletter"`.
* Detects promotions (`discount`, `sale`, `% off`) -> `category = "promotion"`.
* Generates an appropriate template draft based on category.

---

## 8. Background Daemons & Automation Engine (`server.js`)

In `backend/server.js`, two permanent background timers run asynchronously:

### 8.1 Live Email Ingestion Loop (Every 60 Seconds)
```javascript
setInterval(autoSyncEmails, 60000);
```
* Spawns `python backend/agent.py` in the background with `PYTHONIOENCODING=utf-8`.
* **Safety Timeout Guard**: Terminates the subprocess if it exceeds 90 seconds to prevent thread starvation.
* Tracks `lastSyncTimestamp` and `lastSyncStatus` (`ok`, `syncing`, `timeout`, `error`).
* Exposes status to frontend via `GET /api/monitoring/status`.

### 8.2 Auto-Send Dispatcher Loop (Every 60 Seconds)
```javascript
setInterval(checkAutoSend, 60000);
```
1. Queries SQLite for pending drafts ready for scheduled dispatch:
   ```sql
   SELECT * FROM emails WHERE status = 'Pending' AND send_at IS NOT NULL AND send_at <= ?
   ```
2. For each eligible email:
   * Skips if `requires_approval == 1`.
   * Resolves mailbox credentials from `imap_accounts`.
   * Spawns `send_email.py` passing recipient, subject, body, and credentials.
   * On exit code `0`: Updates status to `'Auto-Sent'`.
   * On exit code `!= 0`: Updates status to `'Failed'`.

### 8.3 Configurable Auto-Reply Delay
In **Settings**, users can configure the countdown delay stored in `settings.ruleAutoSendDelay`:
* `5` (5 minutes)
* `10` (10 minutes)
* `20` (20 minutes — Default)
* `30` (30 minutes)
* `60` (1 hour)
* `0` (Manual Approval Only — sets `send_at = NULL` so drafts are never auto-sent)

---

## 9. Outbound Email Dispatcher (`send_email.py`)

Outbound email delivery is centralized in `backend/send_email.py`. It accepts a JSON payload over `stdin`:
```json
{
  "recipient": "client@example.com",
  "subject": "Re: Project Proposal",
  "body": "Hello, thank you for reaching out...",
  "smtp_server": "smtp.gmail.com",
  "smtp_user": "user@gmail.com",
  "smtp_pass": "decrypted_password",
  "auth_type": "oauth | password",
  "oauth_refresh_token": "decrypted_refresh_token"
}
```

### Dispatch Logic
1. **Google XOAUTH2 Protocol**:
   If `auth_type == 'oauth'`, it exchanges the refresh token for a fresh Google access token and authenticates on port 465:
   ```python
   with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as server:
       def auth_obj(challenge=None):
           return f"user={smtp_user}\x01auth=Bearer {access_token}\x01\x01"
       server.auth('XOAUTH2', auth_obj)
       server.sendmail(smtp_user, [recipient], msg.as_string())
   ```
2. **Standard SMTP SSL / TLS**:
   If `auth_type == 'password'` and an app password is provided, logs in via `server.login(smtp_user, smtp_pass)`.
3. **Simulation Fallback**:
   If offline or testing without live mailboxes, logs simulation dispatch and exits with code `0`, allowing testing without external dependencies.

---

## 10. Frontend Single-Page Application (SPA) Architecture

The user interface is a pure Vanilla JavaScript SPA (`frontend/dashboard.html` + `frontend/js/app.js` + `frontend/css/style.css`).

### 10.1 Views & Sidebar Navigation
* **Universal Inbox (`#tab-monitoring`)**: Live inbox feed, priority breakdown cards, unified filter toolbar, and full email modal.
* **AI Drafts (`#tab-drafts`)**: 4-tier draft queue with live countdown timers, inline editor, and 1-click approval.
* **Sent Logs (`#tab-tasks`)**: Unified historical audit log of all outbound messages.
* **AI Composer (`#tab-composer`)**: Interactive outbound email generator and dispatcher.
* **Analytics (`#tab-analytics`)**: Activity charts and response gauges.
* **Admin Center (`/admin.html`)**: User administration, mailbox health, and Gemini API test suite.
* **Settings (`#tab-settings`)**: Mailbox configuration, auto-reply countdown policy, and Gemini API key management.

### 10.2 Header & Live Monitor Status
In the top header, an interactive status pill communicates sync health:
* 🟢 **Live Monitor Active**: Green pulsing dot, relative ticker (`Just now`, `24s ago`), checks every 30 seconds.
* 🟡 **Syncing Inbox...**: Amber pulsing dot during active background execution.
* 🔴 **Not Connected**: Red pulsing dot when no mailboxes are configured.
* **Interactive Trigger**: Clicking the badge or the **`Run Agent`** button immediately triggers `POST /api/run-agent`.

### 10.3 Universal Inbox: Unified Single-Line Filter Toolbar
Replaced messy double-stacked rows with a single, sleek horizontal toolbar:
```html
<div class="monitoring-filter-toolbar">
  <div class="filter-left-group">
    <!-- Priority Chips -->
    <span class="filter-group-title">Priority:</span>
    [ All (20) ] [ 🔴 High (2) ] [ 🟡 Med (3) ] [ 🟢 Low (15) ]
    <div class="filter-divider"></div>
    <!-- Category Chips -->
    <span class="filter-group-title">Category:</span>
    [ All ] [ ⭐ Important ] [ 📰 News ] [ 🏷️ Promo ] [ 🚫 Spam ]
  </div>
  <!-- Search Input -->
  [ Search sender, subject, summary... (x) ]
</div>
```

### 10.4 AI Drafts: 4-Tier Queue Lifecycle
The AI Drafts module organizes drafts into 4 segregated queues:
1. **Active Queue (`≤ 20m`)**: Fresh drafts with active auto-send countdowns (capped at 20 items per view to avoid cognitive overload).
2. **Expired / Older Queue (`> 20m`)**: Drafts exceeding the 20-minute window or held for manual review.
3. **Important Pitches**: High-priority client inquiries, business proposals, and interview requests.
4. **Processed History**: Historical records of approved and auto-sent replies.

### 10.5 Sent Logs: Complete Outbound Audit Feed
Aggregates every outbound message sent across the entire system:
* ✍️ **AI Composer Outbound**: Direct outbound emails composed with the writing assistant.
* ⚡ **Auto-Sent Replies**: Automatically dispatched routine replies.
* ✅ **Approved Drafts**: Human-reviewed and approved AI drafts.
* **Interactive Filters**: Filter chips for `All Sent`, `✍️ AI Composer`, `⚡ Auto-Sent`, `✅ Approved Drafts`, and real-time search.

### 10.6 Dark & Bright Mode Theme Engine
* Stored in `localStorage.getItem('app_theme')`.
* Toggled via `.sidebar-theme-row` in the sidebar footer.
* Applies `.light-mode` to `<body>`, overriding CSS variables for backgrounds, borders, and text colors.

---

## 11. Complete REST API Specification

All endpoints require `Authorization: Bearer <session_token>` unless specified as Public.

### 11.1 Authentication & User Endpoints
| Method | Endpoint | Auth | Description | Payload / Query | Response |
|---|---|---|---|---|---|
| `POST` | `/api/signup` | Public | Create new user account | `{ email, password }` | `{ success: true, message }` |
| `POST` | `/api/login` | Public | Authenticate user | `{ email, password }` | `{ success: true, token, user }` |
| `POST` | `/api/forgot-password` | Public | Generate password reset OTP | `{ email }` | `{ success: true, message }` |
| `POST` | `/api/reset-password` | Public | Reset password with OTP | `{ email, otp, newPassword }` | `{ success: true, message }` |
| `GET` | `/api/users` | Admin | List all registered users | None | `[ { id, email, role, ... } ]` |
| `POST` | `/api/users` | Admin | Create user via Admin | `{ email, password, role }`| `{ success: true, user }` |
| `DELETE`| `/api/users/:id` | Admin | Delete user | None | `{ success: true, message }` |

### 11.2 Mailbox & Synchronization Endpoints
| Method | Endpoint | Auth | Description | Payload / Query | Response |
|---|---|---|---|---|---|
| `GET` | `/api/monitoring/status`| User | Check live sync status | None | `{ success: true, isSyncing, lastSyncTimestamp, isConnected }` |
| `POST` | `/api/run-agent` | User | Trigger on-demand sync | None | `{ success: true, message }` |
| `GET` | `/api/imap-accounts` | User | List user mailboxes | None | `[ { id, email, imap_server, auth_type } ]` |
| `POST` | `/api/imap-accounts` | User | Add mailbox credentials | `{ email, server, port, user, password }` | `{ success: true, account }` |
| `DELETE`| `/api/imap-accounts/:id`| User| Remove mailbox | None | `{ success: true, message }` |
| `GET` | `/auth/google` | Public | Initiate Google OAuth | `?token=...&userId=...` | HTTP 302 Redirect to Google |
| `GET` | `/auth/google/callback` | Public | Google OAuth Callback | `?code=...&state=...` | HTTP 302 Redirect to Dashboard |

### 11.3 Email Management Endpoints
| Method | Endpoint | Auth | Description | Payload / Query | Response |
|---|---|---|---|---|---|
| `GET` | `/api/emails` | User | Fetch all user emails | None | `[ { id, sender, subject, ... } ]` |
| `GET` | `/api/emails/:id` | User | Get single email detail | None | `{ id, sender, body, draft_reply, ... }` |
| `DELETE`| `/api/emails/:id` | User | Delete email and draft | None | `{ success: true, message }` |
| `POST` | `/api/emails/:id/draft` | User | Save edited draft | `{ draft_reply, auto_send_delay }` | `{ success: true, email }` |
| `POST` | `/api/emails/:id/approve`| User | Approve and send draft | None | `{ success: true, message }` |
| `POST` | `/api/emails/:id/reject` | User | Reject draft | None | `{ success: true, message }` |
| `POST` | `/api/emails/:id/toggle-autosend` | User | Toggle auto-dispatch timer | None | `{ success: true, send_at }` |
| `POST` | `/api/emails/clean-junk` | User | Purge spam & clutter | None | `{ success: true, message }` |
| `POST` | `/api/clean-inbox` | User | Purge clutter by category | `{ purgeCategories, olderThanDays }` | `{ success: true, message }` |

### 11.4 AI Composer & Outbound Endpoints
| Method | Endpoint | Auth | Description | Payload / Query | Response |
|---|---|---|---|---|---|
| `POST` | `/api/generate-email` | User | Generate draft with Gemini | `{ prompt, tone, length, referenceEmail }` | `{ success: true, draft }` |
| `POST` | `/api/send-custom-email` | User | Dispatch AI Composer email | `{ recipient, subject, body }` | `{ success: true, message }` |

### 11.5 Analytics & Tasks Endpoints
| Method | Endpoint | Auth | Description | Payload / Query | Response |
|---|---|---|---|---|---|
| `GET` | `/api/stats` | User | Top summary counter stats | None | `{ total, urgent, drafted, sent }` |
| `GET` | `/api/analytics` | User | Chart data for Analytics | None | `{ by_day, by_category, by_priority, response_rate }` |
| `GET` | `/api/export` | User | Export email logs to CSV | None | CSV File Download |
| `GET` | `/api/tasks` | User | List action item tasks | None | `[ { id, title, status, priority, ... } ]` |
| `POST` | `/api/tasks` | User | Create custom task | `{ title, description, priority, dueDate }` | `{ success: true, task }` |
| `PUT` | `/api/tasks/:id` | User | Update task status | `{ status }` | `{ success: true, task }` |

---

## 12. Environment Configuration (`.env`)

Located at `.env` in the project root:
```ini
# Application Server Port
PORT=3000

# Google Gemini Generative AI API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Cryptographic Secret for AES-256 Secret Encryption and Sessions
SESSION_SECRET=a_very_long_random_hex_string_32_bytes_or_more
ENCRYPTION_SECRET=a_very_long_random_hex_string_32_bytes_or_more

# Default / Fallback Mailbox (Optional)
IMAP_SERVER=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your_email@gmail.com
IMAP_PASSWORD=your_gmail_app_password

# Google OAuth2 Credentials
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

---

## 13. Deployment, Execution & Operational Guide

### 13.1 Local Development Startup
1. **Install Node Dependencies**:
   Native dependencies only; no `node_modules` required for basic HTTP server.
2. **Install Python Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
   *(Installs: `imapclient`, `openpyxl`, `google-genai`)*
3. **Start Server**:
   ```bash
   node backend/server.js
   ```
   *Windows shortcut: Run `.\run.ps1` or `run.bat`*
   *Linux/macOS: Run `./run.sh`*
4. **Access Portal**:
   * User Portal: `http://localhost:3000`
   * Dashboard: `http://localhost:3000/dashboard.html`
   * Admin Center: `http://localhost:3000/admin.html`

### 13.2 Testing & Simulation Mode
To test email ingestion and AI processing without connecting a live IMAP server:
```bash
python backend/agent.py --simulate --user-id 1
```
This loads realistic mock emails (server outages, client inquiries, recruitment interview invitations, and promotional clutter) into the database, generating drafts and action items via the AI pipeline.
