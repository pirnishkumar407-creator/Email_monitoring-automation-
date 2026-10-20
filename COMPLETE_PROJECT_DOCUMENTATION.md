# AI Email Automation & Monitoring System
## Complete Comprehensive Project Documentation (Start to Finish)

---

## 1. Project Title & Overview

* **Project Title**: **AI-Powered Email Automation & Intelligent Inbox Monitoring System**
* **Short Name / Brand**: **AI Email Agent (MailPulse AI)**
* **Author / Developer**: Pirnish Kumar
* **Project Type**: Full-Stack Autonomous Email Assistant, Ingestion Daemon & Inbox Orchestration Platform
* **Architecture Style**: Decoupled Micro-Process Architecture (Node.js Native Backend + Python Worker Daemons + Vanilla JS SPA)

### Executive Summary
The **AI-Powered Email Automation & Intelligent Inbox Monitoring System** is an enterprise-grade, privacy-conscious autonomous email management platform. It eliminates email fatigue by combining live IMAP/OAuth2 mailbox polling, Google Gemini Large Language Models (`gemini-1.5-flash` / `gemini-2.5`), and a resilient background dispatch daemon. 

The system operates 24/7 in the background: fetching incoming messages, classifying their urgency and category, extracting concrete actionable tasks, generating professional context-aware reply drafts, and queuing routine responses on an auto-send countdown timer (with full human-in-the-loop override). Furthermore, it provides an outbound AI Composer, interactive Canvas analytics, multi-mailbox management, and an administrative control suite.

---

## 2. Project Objectives

1. **Autonomous Inbox Ingestion**: Automatically poll connected mailboxes (Gmail via Google OAuth2 or any standard IMAP server) in the background without requiring user presence or page refreshes.
2. **Cognitive Load Reduction**: Use state-of-the-art Generative AI (Google Gemini) to read, summarize, prioritize, and categorize emails into actionable buckets (`High`, `Medium`, `Low` priority; `Important`, `Newsletter`, `Promotion`, `Spam`).
3. **Automated Response Generation**: Synthesize polite, tone-calibrated, and contextually accurate reply drafts instantly upon email arrival.
4. **Human-in-the-Loop Safe Automation**: Implement a configurable safety window (e.g., 20-minute countdown) where low-risk emails are scheduled to auto-send, giving users ample time to review, edit, cancel, or approve drafts immediately.
5. **Actionable Task Extraction**: Detect questions, deadlines, commitments, and action items embedded in emails and automatically populate an interactive Kanban/To-Do task tracker.
6. **Interactive AI Outbound Composer**: Provide a specialized writing studio where users can instruct the AI to generate outbound emails from scratch using custom tones (Professional, Friendly, Direct, Sales, Casual).
7. **Complete Auditing & Double Logging**: Maintain an immutable SQLite audit trail of all inbound and outbound emails, while concurrently logging transactional rows into an Excel workbook (`email_log.xlsx`).
8. **Zero-Bloat Self-Hosted Architecture**: Eliminate heavy web frameworks (Express, React) in favor of high-performance Node.js built-ins (`node:sqlite`, native HTTP, native crypto) and lightweight Python automation scripts.

---

## 3. Existing System vs. Proposed System

### 3.1 The Existing System (Traditional Email Clients)
Traditional email clients (e.g., standard Outlook, default Gmail web client, Thunderbird) suffer from fundamental operational bottlenecks:
* **Manual Triaging**: Users must read every incoming subject line and body to determine whether an email is urgent, a sales pitch, or spam.
* **Context Switching & Email Overload**: Professionals spend 25–40% of their workday reading and typing repetitive emails, distracting them from high-value tasks.
* **Missed Deadlines & Commitments**: Action items and meeting requests buried in long threads are frequently forgotten because traditional inboxes lack native action-item extraction.
* **Static Organization**: Rule-based filters (e.g., "if sender contains X move to folder Y") are brittle and cannot evaluate semantic meaning, urgency, or sender intent.
* **Security & Credential Risks**: Users often store plain-text passwords or leave credentials unencrypted in configuration files.

### 3.2 The Proposed System (AI Email Automation Platform)
The proposed solution transforms the passive inbox into an active intelligent partner:
* **Autonomous Intelligence**: Google Gemini LLM acts as an executive assistant that reads, understands context, summarizes threads into 2 sentences, and tags urgency.
* **Dual-Search Ingestion Engine**: Eliminates the "mobile read desync" flaw by concurrently searching `UNSEEN` and `SINCE Today`, ensuring emails read on smartphones are still parsed.
* **Automated & Guardrailed Dispatch**: Safe auto-reply timers allow routine emails to be dispatched automatically while flagging high-stakes emails for mandatory human review (`requires_approval = 1`).
* **Built-in Task Kanban**: Automatically parses commitments into structured tasks with due dates and priority tags.
* **Integrated Outbound Composer**: Drafts new emails from natural language prompts in seconds.
* **Multi-Tier Security**: Password encryption via AES-256-CBC, PBKDF2-SHA512 password hashing, and 1-click Google OAuth2 integration with zero saved plain passwords.

| Feature / Metric | Existing Traditional System | Proposed AI Email System |
| :--- | :--- | :--- |
| **Email Triaging** | 100% Manual reading & sorting | Automated AI Priority & Category classification |
| **Drafting Replies** | Manual typing from scratch | Context-aware AI drafts ready in seconds |
| **Task Detection** | Manual note-taking or third-party apps | Automated extraction into Kanban board |
| **Dispatch Model** | Immediate manual send only | Configurable timer auto-send + 1-click human approval |
| **Outbound Drafting** | Blank text editor | AI Composer with tone, length, and intent selectors |
| **Analytics** | Minimal or requires paid add-ons | Built-in HTML5 Canvas charts & Excel logs |
| **System Footprint** | Heavy proprietary software | Ultra-lightweight native Node.js + Python micro-engine |

---

## 4. System Architecture & High-Level Workflow

The system employs a **decoupled asynchronous architecture** separating the user-facing web interface, the REST API server, background ingestion workers, and outbound dispatch engines.

```
+---------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER                                     |
|  Single-Page Application (HTML5, Vanilla CSS3, app.js, charts.js, auth.js, admin.js)  |
+-------------------------------------------+-------------------------------------------+
                                            | HTTP REST API (Bearer Session Tokens)
                                            v
+---------------------------------------------------------------------------------------+
|                                NODE.JS BACKEND (server.js)                            |
|  - Native HTTP REST Server (Zero Framework Overhead)                                  |
|  - Local SQLite Database (node:sqlite DatabaseSync) in WAL Mode                       |
|  - Cryptographic Engine: PBKDF2-SHA512 Hasher + AES-256-CBC Encryptor                 |
|  - Google OAuth2 Authorization Code Flow Handler                                      |
|  - Permanent Background Daemon Loops:                                                 |
|      * Ingestion Daemon (Every 60s -> Spawns agent.py)                                 |
|      * Auto-Send Dispatcher Daemon (Every 60s -> Spawns send_email.py)                |
+-------------------+-----------------------------------------------+-------------------+
                    |                                               |
       Spawns Subprocess                               Spawns Subprocess
                    v                                               v
+---------------------------------------+   +-------------------------------------------+
|          PYTHON AGENT ENGINE          |   |           PYTHON DISPATCH ENGINE          |
|              (agent.py)               |   |              (send_email.py)              |
|  - IMAPClient (SSL 993) / Google XOAUTH2|  |  - smtplib.SMTP_SSL (Port 465)            |
|  - Dual Search: UNSEEN + SINCE Today  |   |  - Google XOAUTH2 & Password Auth         |
|  - RFC 2047 MIME Header Parser        |   |  - Outbound Draft & Composer Dispatch     |
|  - Google Gemini Generative AI Client |   |  - Simulation Fallback Safe Mode          |
|  - Heuristic Offline Fallback Engine  |   +-------------------------------------------+
|  - OpenPyXL Excel Audit Logger        |
+-------------------+-------------------+
                    |
                    +-----------------------+
                    v                       v
         +--------------------+   +-------------------+
         |  Google Gemini AI  |   |  IMAP/SMTP Server |
         |   (REST API/LLM)   |   |   (Gmail / Live)  |
         +--------------------+   +-------------------+
```

### Complete End-to-End Data Workflow
1. **Background Polling**: Every 60 seconds, `server.js` triggers `autoSyncEmails()`, spawning `agent.py`.
2. **Mailbox Ingestion**: `agent.py` connects to IMAP over SSL (Port 993) using password or XOAUTH2 credentials. It executes a dual search (`UNSEEN` and `SINCE Today`).
3. **MIME Parsing**: Subject lines and body contents are parsed, HTML is stripped, and character sets are decoded to UTF-8.
4. **Duplicate Deduplication**: The agent compares incoming message signatures against `users.db`. Existing messages are skipped.
5. **AI Analysis (Gemini)**: Unprocessed emails are passed to Google Gemini. Gemini returns a structured JSON payload containing priority, category, intent, summary, action items, draft reply, and approval flags.
6. **Offline Fallback**: If the Gemini API is unreachable or rate-limited (HTTP 429), an offline heuristic keyword classifier takes over without interrupting service.
7. **Database Storage**: Email records are inserted into `emails`, action items are inserted into `tasks`, and row entries are appended to `email_log.xlsx`.
8. **UI Presentation**: The dashboard displays new emails in real-time, categorized into priority badges, intent tags, and draft queues.
9. **Review & Auto-Send**:
   - **Scenario A (Auto-Send)**: If the draft is low-risk, a 20-minute countdown starts. When the timer hits 0, `checkAutoSend()` spawns `send_email.py` to dispatch the reply via SMTP.
   - **Scenario B (Human Override)**: The user clicks **Approve** to dispatch immediately, or edits the text (resetting the timer), or clicks **Reject** to discard the draft.

---

## 5. Technologies Used & Implementation Details

### 5.1 Frontend Technologies
* **HTML5**: Semantic tags (`<header>`, `<nav>`, `<main>`, `<section>`, `<aside>`) optimized for screen readers and search performance.
* **Vanilla CSS3**:
  * Pure CSS custom properties (variables) supporting seamless real-time **Bright Mode** and **Dark Mode** toggling.
  * Modern CSS Grid and Flexbox layouts.
  * Glassmorphism effects with backdrop filters, subtle border radiuses, and CSS keyframe micro-animations.
* **Vanilla JavaScript (ES6+)**:
  * Zero bloated frontend dependencies (no React, Vue, or Angular build steps needed).
  * Modular script organization: `app.js` (SPA controller & view routing), `auth.js` (authentication, password resets), `admin.js` (administrative control center), `charts.js` (Canvas charts).
* **HTML5 Canvas (Custom Charting Engine)**:
  * Zero-dependency vector chart renderer built inside `charts.js`: renders responsive Daily Volume Bar Charts, Category Donut Charts, and Response Rate Gauge Meters.

### 5.2 Backend Technologies
* **Node.js (v18+) Native HTTP Server**: Built entirely on Node.js core modules (`http`, `crypto`, `child_process`, `fs`, `path`). Eliminates Express overhead for minimal memory consumption (~30 MB RAM).
* **Native SQLite (`node:sqlite`)**:
  * Utilizes Node's native `DatabaseSync` engine.
  * Configured with **Write-Ahead Logging (WAL)**: `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;`. This enables smooth, lock-free concurrent read/write operations between the Node.js API server and the Python background agents.
* **Cryptographic Engine**:
  * **PBKDF2-SHA512**: 10,000 iterations with 16-byte random salts for user passwords.
  * **AES-256-CBC**: Encrypts mailbox passwords and OAuth2 refresh tokens before persistence.

### 5.3 Python AI Ingestion & Email Dispatch Engines
* **Python 3.10+**: Chosen for its rich ecosystem of email handling and AI connectors.
* **`imapclient`**: High-level, RFC-compliant IMAP library handling SSL socket negotiation, XOAUTH2 authentication, folder selection, and message retrieval.
* **Google Gemini AI (`google-genai` / REST API)**: Powers email comprehension, reasoning, categorization, task extraction, and draft synthesis.
* **`openpyxl`**: Interacts with Microsoft Excel workbooks to create and append structured audit logs.
* **`smtplib` & `email.mime`**: Native Python libraries used by `send_email.py` to establish secure SSL connections on Port 465 (or TLS on Port 587) and send multipart messages.

---

## 6. Core Modules & Detailed Feature Breakdown

```
+---------------------------------------------------------------------------------------+
|                                    SYSTEM MODULES                                     |
+-------------------+-------------------+-------------------+---------------------------+
| 1. Authentication | 2. Ingestion &    | 3. AI Intelligence| 4. Outbound Dispatch      |
|    & RBAC         |    IMAP Polling   |    & Gemini LLM   |    & SMTP Engine          |
+-------------------+-------------------+-------------------+---------------------------+
| 5. Universal      | 6. AI Drafts &    | 7. Task Kanban &  | 8. AI Outbound            |
|    Inbox Feed     |    Auto-Queues    |    Action Items   |    Composer Studio        |
+-------------------+-------------------+-------------------+---------------------------+
| 9. Sent Logs &    | 10. Analytics &   | 11. Admin Control | 12. Settings & Mailbox    |
|    Audit Trail    |     Canvas Charts |     Center        |     Configuration         |
+-------------------+-------------------+-------------------+---------------------------+
```

### 6.1 Authentication, Security & User Management Module
* **Multi-Tenant User Isolation**: Every email, mailbox configuration, task, and log entry is scoped to a specific `user_id`.
* **Cryptographic Password Handling**: Passwords are never stored in plaintext. They are salted with 16 random cryptographic bytes and hashed using PBKDF2-SHA512.
* **Session Bearer Tokens**: Successful login issues a 32-byte cryptographic hex token valid for 7 days, tracked in the `sessions` table.
* **Password Recovery OTP System**: Users requesting password reset receive a 6-digit one-time password (OTP) valid for 15 minutes. The OTP is hashed via SHA-256 before database storage to prevent token leakage.
* **Google OAuth2 One-Click Login**: Provides direct Google Cloud OAuth2 authentication, acquiring scoped permissions (`https://mail.google.com/`, `userinfo.email`) so users never have to enter App Passwords.

### 6.2 Background Monitoring & Ingestion Engine (`agent.py`)
* **Dual-Search Ingestion (UNSEEN + SINCE Today)**: Solves the common bug where opening an email on a mobile phone marks it as "Read" on the server, causing traditional scripts to miss it. By merging `UNSEEN` and `SINCE Today`, all emails from the current calendar day are ingested, and duplicates are filtered out via database lookups.
* **Autonomous 60-Second Daemon**: `server.js` maintains a periodic timer that triggers `agent.py` in the background. A 90-second watchdog timer terminates frozen subprocesses.
* **Live UI Status Pill**: The dashboard displays a pulsing health indicator (🟢 Active, 🟡 Syncing, 🔴 Disconnected) and relative timestamps ("Synced 12s ago").

### 6.3 AI Intelligence & LLM Reasoning Engine
* **Context-Aware Classification**: Prompts Google Gemini with the email sender, subject, date, and body, requesting a strict JSON response:
  ```json
  {
    "priority": "High | Medium | Low",
    "category": "important | newsletter | promotion | spam",
    "intent": "Brief string indicating purpose",
    "summary": "1-2 sentence high-level summary",
    "action_items": ["Action item 1", "Action item 2"],
    "draft_reply": "Polite professional reply",
    "requires_approval": true | false
  }
  ```
* **Guardrail Enforcement**: Newsletters, automated marketing messages, and promotional clutter automatically have `draft_reply` set to empty and `requires_approval` set to false, preventing embarrassing automated replies to bots.
* **Offline Heuristic Fallback**: If the Gemini API key is missing or encounters HTTP 429 quota limits, an offline rule-based regex analyzer scans for critical keywords (`urgent`, `down`, `invoice`, `meeting`) to ensure uninterrupted triage.

### 6.4 Dashboard & Universal Inbox
* **High-Impact Metric Cards**: Four summary tiles at the top of the interface:
  1. **Total Processed**: Count of all emails parsed.
  2. **Urgent Alerts**: Count of `High` priority emails requiring immediate attention.
  3. **Pending Drafts**: Count of AI-generated drafts awaiting review or countdown dispatch.
  4. **Emails Sent**: Total outbound messages delivered.
* **Unified Single-Line Filter Toolbar**: Clean horizontal filter bar combining Priority chips (`All`, `High`, `Medium`, `Low`), Category chips (`All`, `Important`, `Newsletter`, `Promotion`, `Spam`), and a live text search bar.
* **Split-Pane & Modal Viewer**: Clicking any email displays its full body, AI summary, detected intent, extracted action items, and drafted response.

### 6.5 AI Drafts & 4-Tier Automated Queue Lifecycle
* **Active Queue (`≤ 20 min`)**: Recent drafts with a live countdown timer ticking down to automatic dispatch.
* **Expired / Held Queue (`> 20 min`)**: Drafts held for manual review or flagged with `requires_approval = 1`.
* **Important Pitches**: Filtered bucket highlighting business proposals, inquiries, and recruiter opportunities.
* **Processed History**: Complete record of previously approved and auto-sent responses.
* **Interactive Draft Controls**:
  * **Approve & Send**: Dispatches the email immediately via SMTP.
  * **Inline Editor**: Allows modifying draft text; saving edits automatically resets the auto-send countdown timer.
  * **Reject / Delete**: Discards the draft.
  * **Toggle Timer**: Freezes or unfreezes the auto-dispatch countdown.

### 6.6 Task Kanban & Action Item Tracker
* **Automated Task Mining**: Whenever Gemini detects questions, deadlines, deliverables, or follow-ups in an incoming message, it extracts them into the `tasks` table.
* **Status Management**: Tasks feature Kanban lifecycle states: `To Do`, `In Progress`, and `Completed`.
* **Manual Task Creation**: Users can create independent custom tasks with priority levels and due dates directly from the UI.

### 6.7 AI Composer Studio (Outbound Mail Generator)
* **Natural Language Drafting**: Users provide a brief prompt (e.g., "Write a follow-up to client John regarding the pending invoice for June").
* **Tone & Style Controls**: Supports 5 customizable tones:
  * 👔 *Professional* (formal business communication)
  * 🤝 *Friendly* (warm, collaborative tone)
  * ⚡ *Direct* (concise, bulleted, no fluff)
  * ☕ *Casual* (relaxed, everyday conversational style)
  * 📈 *Sales* (persuasive, high-converting outreach)
* **Contextual Thread Reference**: Allows referencing an existing email ID so the AI drafts a contextual reply to a prior thread.
* **Direct Dispatch**: Users can edit the generated draft and click **Send Custom Email** to deliver it through their connected SMTP account immediately.

### 6.8 Sent Logs & Outbound Audit Feed
* **Centralized Dispatch Ledger**: Combines all outbound emails from:
  1. ✍️ **AI Composer Outbound**: Direct emails composed in the writing studio.
  2. ⚡ **Auto-Sent Replies**: Automated responses sent by the background daemon.
  3. ✅ **Approved Drafts**: Replies reviewed and manually sent by the user.
* **Full Delivery Transparency**: Displays sender mailbox, recipient, subject line, timestamp, and delivery status (`Sent`, `Auto-Sent`, `Failed`).

### 6.9 Analytics & Insights Module
* **Zero-Dependency Canvas Charts**: Fast, lightweight HTML5 Canvas charts rendered without heavy chart libraries:
  * **Email Volume by Day**: Visual bar chart tracking incoming and outgoing email trends over the past 7 days.
  * **Category Distribution**: Multi-color donut chart illustrating percentages of Important, Newsletter, Promotional, and Spam mail.
  * **Priority Distribution**: Visual progress breakdown of High, Medium, and Low priority emails.
  * **Response Rate Gauge**: Semi-circular gauge showing the ratio of received messages answered vs. pending.
* **CSV Data Export**: One-click download button exporting the complete email ledger to `.csv` for external analysis in Excel, PowerBI, or Google Sheets.

### 6.10 Administrative Center (`admin.html`)
* **Role-Based Access Control (RBAC)**: Restricted to accounts with `role = 'admin'`.
* **User Management Table**: View all registered users, create new accounts with predefined roles, and delete inactive users.
* **Mailbox Health Inspector**: Real-time status list of all connected IMAP accounts, authentication types (OAuth vs. Password), and connection health.
* **AI Engine Playground / Sandbox**: Admin interface to run live test prompts against Google Gemini, verifying API latency and token health.

### 6.11 Settings & Configuration Manager
* **Mailbox Configuration**: Add and remove multiple email accounts with custom IMAP/SMTP hosts and ports.
* **Google Account Linking**: One-click OAuth2 integration button.
* **API Key Management**: Set and update the Google Gemini API Key dynamically without server restarts.
* **Auto-Reply Countdown Rules**: Dropdown to configure auto-send delays:
  * `5 minutes`
  * `10 minutes`
  * `20 minutes` (Default)
  * `30 minutes`
  * `60 minutes`
  * `0 (Manual Approval Only)` — Completely disables auto-send, requiring manual click for every reply.

---

## 7. Database Schema & Data Models (SQLite WAL)

The system stores all state in `users.db`. Concurrency is managed via:
```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

```
+--------------------+       +-----------------------+       +---------------------+
|       users        |       |     imap_accounts     |       |       emails        |
+--------------------+       +-----------------------+       +---------------------+
| id (PK)            |<--+---| id (PK)               |<--+---| id (PK)             |
| email (UNIQUE)     |   +---| user_id (FK)          |   +---| user_id (FK)        |
| password_hash      |       | email                 |   +---| imap_account_id (FK)|
| salt               |       | imap_server           |       | sender              |
| role               |       | imap_port             |       | subject             |
| reset_token        |       | imap_user             |       | body                |
| created_at         |       | imap_password (ENC)   |       | received_at         |
+--------------------+       | auth_type             |       | priority            |
          |                  | oauth_refresh_token   |       | status              |
          |                  | created_at            |       | category            |
          |                  +-----------------------+       | intent              |
          |                                                  | summary             |
          |                  +-----------------------+       | action_items        |
          |                  |         tasks         |       | draft_reply         |
          |                  +-----------------------+       | send_at             |
          +----------------->| id (PK)               |       | requires_approval   |
          |                  | user_id (FK)          |       +---------------------+
          |                  | email_id (FK)         |                  |
          |                  | title                 |                  |
          |                  | status                |                  |
          |                  | priority              |                  |
          |                  | due_date              |                  |
          |                  +-----------------------+                  |
          |                                                             |
          |                  +-----------------------+                  |
          |                  |       sessions        |                  |
          |                  +-----------------------+                  |
          +----------------->| id (PK, 32-byte hex)  |                  |
                             | user_id (FK)          |                  |
                             | expires_at            |                  |
                             +-----------------------+                  |
```

### Table 1: `users`
| Column | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique user ID |
| `email` | TEXT | UNIQUE NOT NULL | User login email address |
| `password_hash` | TEXT | NOT NULL | PBKDF2-SHA512 password hash |
| `salt` | TEXT | NOT NULL | 16-byte cryptographic salt |
| `role` | TEXT | DEFAULT 'user' | Access level (`admin` or `user`) |
| `reset_token` | TEXT | NULL | JSON string containing hashed OTP and expiration |
| `created_at` | TEXT | NOT NULL | ISO-8601 creation timestamp |

### Table 2: `imap_accounts`
| Column | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique mailbox ID |
| `user_id` | INTEGER | NOT NULL, FK -> `users(id)` | Account owner |
| `email` | TEXT | NOT NULL | Connected mailbox address |
| `imap_server` | TEXT | NOT NULL | IMAP host (e.g., `imap.gmail.com`) |
| `imap_port` | INTEGER | DEFAULT 993 | IMAP SSL port |
| `imap_user` | TEXT | NOT NULL | Authentication username |
| `imap_password` | TEXT | NOT NULL | AES-256-CBC encrypted password |
| `auth_type` | TEXT | DEFAULT 'password' | `'password'` or `'oauth'` |
| `oauth_refresh_token` | TEXT | NULL | AES-256-CBC encrypted Google OAuth token |
| `created_at` | TEXT | NOT NULL | ISO-8601 timestamp |

### Table 3: `emails`
| Column | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique email record ID |
| `user_id` | INTEGER | DEFAULT 1, FK -> `users(id)` | Associated user |
| `sender` | TEXT | NOT NULL | Sender email or outbound recipient |
| `subject` | TEXT | NULL | Decoded RFC 2047 subject |
| `body` | TEXT | NULL | Plaintext body content |
| `received_at` | TEXT | NOT NULL | ISO-8601 timestamp |
| `priority` | TEXT | DEFAULT 'Medium' | `'High'`, `'Medium'`, or `'Low'` |
| `status` | TEXT | DEFAULT 'Pending' | `'Pending'`, `'Sent'`, `'Auto-Sent'`, `'Approved'`, `'Failed'` |
| `category` | TEXT | DEFAULT 'important' | `'important'`, `'newsletter'`, `'promotion'`, `'spam'`, `'composer'` |
| `intent` | TEXT | NULL | AI-extracted purpose (e.g. "Invoice Follow-up") |
| `summary` | TEXT | NULL | 1-2 sentence AI summary |
| `action_items` | TEXT | NULL | JSON array of extracted action items |
| `draft_reply` | TEXT | NULL | AI-generated reply draft |
| `send_at` | TEXT | NULL | ISO-8601 scheduled auto-send timestamp |
| `requires_approval` | INTEGER | DEFAULT 0 | 1 = Requires human approval; 0 = Auto-send eligible |
| `imap_account_id` | INTEGER | NULL, FK -> `imap_accounts(id)` | Source mailbox |

### Table 4: `tasks`
| Column | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique task ID |
| `user_id` | INTEGER | DEFAULT 1, FK -> `users(id)` | Task owner |
| `email_id` | INTEGER | NULL, FK -> `emails(id)` | Originating email ID |
| `title` | TEXT | NOT NULL | Action item description |
| `description` | TEXT | NULL | Context or notes |
| `status` | TEXT | DEFAULT 'To Do' | `'To Do'`, `'In Progress'`, or `'Completed'` |
| `priority` | TEXT | DEFAULT 'Medium' | `'High'`, `'Medium'`, or `'Low'` |
| `due_date` | TEXT | NULL | ISO deadline date |
| `created_at` | TEXT | NOT NULL | ISO-8601 creation timestamp |

### Table 5: `sessions`
| Column | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | 32-byte cryptographic hex token |
| `user_id` | INTEGER | NOT NULL, FK -> `users(id)` | Authenticated user |
| `expires_at` | TEXT | NOT NULL | ISO-8601 expiration (7 days) |

### Table 6: `settings`
| Column | Type | Constraints | Purpose |
| :--- | :--- | :--- | :--- |
| `key` | TEXT | PRIMARY KEY | Key name (e.g., `ruleAutoSendDelay`, `geminiApiKey`) |
| `value` | TEXT | NULL | Serialized setting value |

---

## 8. Complete REST API Specifications

All endpoints under `/api/` (except public auth endpoints) require authentication via:
`Authorization: Bearer <session_token>`

### 8.1 Authentication Endpoints
| HTTP Method | Route | Access | Payload | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/signup` | Public | `{ email, password }` | `{ success: true, message: "Account created" }` |
| `POST` | `/api/login` | Public | `{ email, password }` | `{ success: true, token, user: { id, email, role } }` |
| `POST` | `/api/forgot-password` | Public | `{ email }` | `{ success: true, message: "OTP generated" }` |
| `POST` | `/api/reset-password` | Public | `{ email, otp, newPassword }` | `{ success: true, message: "Password updated" }` |

### 8.2 Mailbox & Synchronization Endpoints
| HTTP Method | Route | Access | Payload | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/monitoring/status` | User | None | `{ success: true, isSyncing, lastSyncTimestamp, isConnected }` |
| `POST` | `/api/run-agent` | User | None | `{ success: true, message: "Agent triggered successfully" }` |
| `GET` | `/api/imap-accounts` | User | None | `[ { id, email, imap_server, auth_type } ]` |
| `POST` | `/api/imap-accounts` | User | `{ email, server, port, user, password }` | `{ success: true, account }` |
| `DELETE` | `/api/imap-accounts/:id` | User | None | `{ success: true, message: "Account deleted" }` |
| `GET` | `/auth/google` | Public | Query: `?token=...&userId=...` | HTTP 302 Redirect to Google OAuth |
| `GET` | `/auth/google/callback`| Public | Query: `?code=...&state=...` | HTTP 302 Redirect to `/dashboard.html` |

### 8.3 Email Management Endpoints
| HTTP Method | Route | Access | Payload | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/emails` | User | None | `[ { id, sender, subject, priority, category, ... } ]` |
| `GET` | `/api/emails/:id` | User | None | `{ id, sender, subject, body, draft_reply, ... }` |
| `DELETE` | `/api/emails/:id` | User | None | `{ success: true, message: "Email deleted" }` |
| `POST` | `/api/emails/:id/draft` | User | `{ draft_reply, auto_send_delay }` | `{ success: true, email }` |
| `POST` | `/api/emails/:id/approve` | User | None | `{ success: true, message: "Email sent successfully" }` |
| `POST` | `/api/emails/:id/reject` | User | None | `{ success: true, message: "Draft rejected" }` |
| `POST` | `/api/emails/:id/toggle-autosend` | User | None | `{ success: true, send_at }` |
| `POST` | `/api/emails/clean-junk`| User | None | `{ success: true, count: 14, message: "Junk purged" }` |
| `POST` | `/api/clean-inbox` | User | `{ purgeCategories, olderThanDays }` | `{ success: true, count, message }` |

### 8.4 AI Composer & Outbound Dispatch
| HTTP Method | Route | Access | Payload | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/generate-email` | User | `{ prompt, tone, length, referenceEmail }` | `{ success: true, draft }` |
| `POST` | `/api/send-custom-email` | User | `{ recipient, subject, body }` | `{ success: true, message: "Email sent" }` |

### 8.5 Tasks, Analytics & Admin Endpoints
| HTTP Method | Route | Access | Payload | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/stats` | User | None | `{ total: 120, urgent: 4, drafted: 12, sent: 38 }` |
| `GET` | `/api/analytics` | User | None | `{ by_day, by_category, by_priority, response_rate }` |
| `GET` | `/api/export` | User | None | CSV File Stream (`Content-Type: text/csv`) |
| `GET` | `/api/tasks` | User | None | `[ { id, title, status, priority, due_date } ]` |
| `POST` | `/api/tasks` | User | `{ title, description, priority, dueDate }` | `{ success: true, task }` |
| `PUT` | `/api/tasks/:id` | User | `{ status }` | `{ success: true, task }` |
| `GET` | `/api/users` | Admin | None | `[ { id, email, role, created_at } ]` |
| `POST` | `/api/users` | Admin | `{ email, password, role }` | `{ success: true, user }` |
| `DELETE` | `/api/users/:id` | Admin | None | `{ success: true, message: "User deleted" }` |

---

## 9. Advantages & Disadvantages

### 9.1 Advantages of the System
1. **Massive Time Savings**: Reduces daily email triaging time by an estimated 70–80%, allowing users to focus on high-priority objectives.
2. **Human-in-the-Loop Safeguards**: Auto-send timers prevent accidental dispatches; sensitive or ambiguous emails require manual approval before sending.
3. **Privacy & Data Sovereignty**: Self-hosted on local SQLite; email bodies are not stored on third-party SaaS cloud databases.
4. **Resilient Offline Fallback**: If the Gemini API is offline or quota-limited, the heuristic engine continues categorizing messages without breaking application workflows.
5. **Zero Framework Bloat**: Starts up in milliseconds and operates with minimal memory consumption (< 60 MB RAM total).
6. **Dual Ingestion Reliability**: Ingests emails read on mobile devices through the hybrid `UNSEEN + SINCE Today` search strategy.
7. **Comprehensive Auditability**: Generates dual audit logs in SQLite and Microsoft Excel (`email_log.xlsx`).

### 9.2 Disadvantages & Limitations
1. **Third-Party LLM API Dependency**: AI drafting and advanced classification require active internet access and a valid Google Gemini API key.
2. **IMAP Protocol Quotas**: Gmail and other email providers enforce daily IMAP fetching limits and SMTP sending quotas (e.g., 500 emails/day for standard Gmail).
3. **Initial Setup Requirement**: Users utilizing standard password authentication must generate a Google App Password rather than using their normal account password (mitigated by Google OAuth2).
4. **Single-Node Scalability**: Designed for single-machine deployment; enterprise multi-node clustering would require migrating from local SQLite to PostgreSQL or Redis.

---

## 10. Future Enhancements & Project Roadmap

1. **Retrieval-Augmented Generation (RAG) over Past Emails**: Integrate a local vector database (e.g., ChromaDB or SQLite-vec) to index historical sent emails, allowing Gemini to match the user's specific writing style and past business agreements.
2. **Multi-Lingual Auto-Translation**: Automatically detect non-English incoming emails, translate them into the user's primary language, and draft responses in the sender's native tongue.
3. **Calendar Meeting Scheduling**: Parse meeting invitations directly and integrate with Google Calendar or Cal.com APIs to propose available time slots automatically.
4. **Webhook & Notification Triggers**: Dispatch push notifications to Slack, Discord, or Telegram whenever an email flagged as `High Priority` is detected.
5. **Native Mobile App Wrapper**: Package the lightweight responsive web UI into an Android/iOS application using Capacitor or Flutter web-view wrappers.

---

## 11. Conclusion

The **AI-Powered Email Automation & Intelligent Inbox Monitoring System** delivers an innovative, end-to-end solution to the modern crisis of email overload. By seamlessly uniting lightweight web engineering, asynchronous background daemon execution, robust cryptographic security, and state-of-the-art Generative AI, the platform automates repetitive correspondence while keeping the user firmly in control.

From background ingestion and real-time live monitoring to AI-generated draft queues, action item Kanban tracking, outbound AI composition, and Canvas analytics, the system provides a comprehensive, secure, and production-ready email operations suite. It exemplifies how modern Large Language Models can be practically embedded into daily productivity workflows to save time, reduce cognitive fatigue, and improve communication responsiveness.
