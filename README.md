# AI Email Automation System

An elegant, premium end-to-end email automation platform. The system connects to a live IMAP mailbox (like Gmail), parses unread messages, leverages Google's Gemini LLMs (`gemini-3.5-flash`) to generate structured AI insights (priority, summaries, and action items), and drafts professional replies. Users can review, edit, and approve these drafts directly from a sleek split-panel dashboard to dispatch them using a live SMTP pipeline.

---

## 📂 Project Directory Structure

```
email/
├── public/                 # FRONTEND static assets
│   ├── index.html          # Auth Login & Sign-Up Portal
│   ├── dashboard.html      # Elegant Light-Blue Dashboard UI
│   ├── style.css           # Combined Stylesheet (Glassmorphism Auth & Light Dashboard)
│   ├── script.js           # Frontend Auth & Session Handler
│   └── dashboard.js        # Dynamic Dashboard Controller
│
├── server.js               # BACKEND REST API Node.js Server
├── agent.py                # BACKEND Email Ingestion Python Agent
├── send_email.py           # BACKEND SMTP Email Dispatcher Subprocess
├── users.db                # SQLite Database (Stores users, emails, and configuration)
├── logs.xlsx               # Excel Ledger logs
├── requirements.txt        # Python dependency manifest
├── run.ps1                 # Windows PowerShell Runner
├── run.bat                 # Windows CMD Batch Runner
├── run.sh                  # macOS/Linux Shell Runner
└── README.md               # Documentation (This file)
```

---

## ✨ Features Included

1. **Sleek Light-Blue Dashboard**: Clean layout designed with smooth CSS Grid/Flexbox alignments, premium typography, custom SVG icons, and reactive hover transitions.
2. **Dynamic Menu Navigation**:
   * **Dashboard**: Home feed showcasing quick metrics (Total Processed, Urgent Alerts, Replies Drafted) and split-pane message reader.
   * **Email History**: Interactive list containing all historical emails.
   * **AI Summary**: Chronological timeline bulletin summarizing ingested emails.
   * **Settings Manager**: Web interface to save IMAP credentials and Gemini API keys directly into SQLite.
3. **Robust SMTP Email Dispatcher**: Approving a draft from the UI spawns a secure Python SMTP SSL helper (`send_email.py`) to log in and send emails directly through your configured mailbox.
4. **429 Rate-Limit Auto-Retry**: Built-in exponential backoff inside `agent.py`. If the Gemini API returns a `Quota Exceeded (429)` error, the agent parses the suggested wait period and pauses automatically before retrying.
5. **Double Logging**: System transactions are stored in a SQLite relational database (`users.db`) and appended to an Excel ledger sheet (`logs.xlsx`).

---

## 🚀 How to Set Up & Run

### 1. Prerequisites
Ensure you have **Node.js** and **Python 3** installed on your system.

### 2. Install Dependencies
Run these commands in your project folder to install the required packages:

* **Python Dependencies**:
  ```cmd
  pip install -r requirements.txt
  ```
  *(Installs `imapclient` and `openpyxl`).*

* **Node.js Dependencies**:
  The server utilizes Node's built-in sqlite module (`node:sqlite`). No external packages are required!

---

### 3. Run the Application

You can execute both the Node web server and the Python background agent simultaneously using the appropriate script:

* **Windows (PowerShell)**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\run.ps1
  ```
* **Windows (Command Prompt / Double-Click)**:
  Double-click `run.bat` or run:
  ```cmd
  .\run.bat
  ```
* **macOS/Linux**:
  ```bash
  chmod +x run.sh
  ./run.sh
  ```

---

### 4. Configuration Settings

You can configure the application in two ways:

1. **Through the UI (Recommended)**:
   * Open **`http://localhost:3000`** in your browser.
   * Go to **Settings** in the sidebar.
   * Enter your Gemini API Key and Gmail credentials (use a [Gmail App Password](https://support.google.com/accounts/answer/185833)), then click **Save**.
2. **Through the Environment File**:
   * Edit the **`.env`** file directly in your root folder:
     ```env
     GEMINI_API_KEY=your_gemini_api_key
     IMAP_SERVER=imap.gmail.com
     IMAP_PORT=993
     IMAP_USER=your-email@gmail.com
     IMAP_PASSWORD=your-app-password
     ```
