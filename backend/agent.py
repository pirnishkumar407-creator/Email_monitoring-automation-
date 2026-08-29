import os
import sys
import sqlite3
import json
import time
import re
import argparse
import urllib.request
import urllib.error
import email as email_module
from datetime import datetime, timedelta, timezone

# Optional dependencies
try:
    from imapclient import IMAPClient
    IMAP_AVAILABLE = True
except ImportError:
    IMAP_AVAILABLE = False

try:
    import openpyxl
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    import hashlib
    CRYPTOGRAPHY_AVAILABLE = True
except ImportError:
    CRYPTOGRAPHY_AVAILABLE = False

DB_FILE = os.path.join(os.path.dirname(__file__), '..', 'users.db')
EXCEL_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'exports', 'logs.xlsx')

# ── Mock Emails for Simulation ───────────────────────────────────────────────

MOCK_EMAILS = [
    {
        "sender": "client-services@techcorp.com",
        "subject": "Quote Request: Custom Web Application Development",
        "body": "Hi team,\n\nWe are looking to develop a customer portal for our retail branch. We require features like auth, payment gateways, and a beautiful analytics dashboard. Our budget is around $25,000, and we need this ready in 3 months. Can you send us a quote?\n\nBest regards,\nSarah Jenkins\nDirector of Operations, TechCorp",
        "priority": "Medium",
        "category": "important",
        "intent": "Request for project quote and timeline discussion",
        "summary": "Sarah Jenkins from TechCorp requested a quote for a custom retail customer portal. Budget is $25k, deadline is 3 months.",
        "requires_approval": 1,
        "action_items": [
            "Prepare a development estimation sheet.",
            "Draft response email asking for API specification details.",
            "Schedule an introductory call with Sarah."
        ],
        "draft_reply": "Subject: Re: Quote Request: Custom Web Application Development\n\nDear Sarah,\n\nThank you for reaching out to us. We would be delighted to assist TechCorp in developing your retail customer portal. Your budget of $25,000 and timeline of 3 months align with our capabilities.\n\nTo provide an accurate quote, could you share any detailed API specifications or design guidelines you have? I'd also love to schedule a brief 15-minute introductory call next Tuesday to align on key details. Please let me know your availability.\n\nBest regards,\nSales & Account Team\nAI Email Automation"
    },
    {
        "sender": "monitoring@cloudalert.net",
        "subject": "URGENT: Production Server Database Load > 95%",
        "body": "ALERT: database-prod-01 is experiencing critically high CPU and RAM usage (98.4%). Connection latency has increased to 4500ms. Response failures are occurring on main API endpoints.\n\nTimestamp: 2026-07-19T11:45:00Z\nHost: aws-us-east-1",
        "priority": "High",
        "category": "important",
        "intent": "Critical infrastructure alert requiring immediate action",
        "summary": "Production database database-prod-01 is overloaded (98.4% usage), leading to API response failures and 4500ms latencies.",
        "requires_approval": 0,
        "action_items": [
            "Check database active connection pool.",
            "Identify and kill any slow-running queries.",
            "Notify the DevOps on-call engineer."
        ],
        "draft_reply": "Subject: Re: URGENT: Production Server Database Load > 95%\n\nHello Team,\n\nThis is an automated acknowledgment: We have received the database load alert for 'database-prod-01'. Priority has been elevated to CRITICAL.\n\nOur on-call engineers have been paged to identify slow queries and optimize connection pools immediately. Updates will follow on the status channel within 10 minutes.\n\nBest regards,\nSupport Operations"
    },
    {
        "sender": "newsletter@marketinginsights.org",
        "subject": "Weekly Tech Trends Newsletter - July 2026",
        "body": "Welcome to your weekly digest! This week, we explore the rise of Node.js 22 SQLite integrations, local LLM configurations with Ollama, and CSS grid layout tips.",
        "priority": "Low",
        "category": "newsletter",
        "intent": "Marketing newsletter — no action required",
        "summary": "Weekly tech newsletter covering Node.js 22 SQLite, local LLM setups with Ollama, and CSS grid tips.",
        "requires_approval": 0,
        "action_items": [],
        "draft_reply": ""
    },
    {
        "sender": "promo@deals-store.com",
        "subject": "🔥 Flash Sale: 70% Off All Electronics!",
        "body": "Don't miss our biggest flash sale of the year! Get up to 70% off on all electronics. Limited time only. Shop now at deals-store.com.",
        "priority": "Low",
        "category": "promotion",
        "intent": "Promotional advertisement — no action required",
        "summary": "Flash sale promotional email from deals-store.com offering 70% off electronics.",
        "requires_approval": 0,
        "action_items": [],
        "draft_reply": ""
    },
    {
        "sender": "hr@company.internal",
        "subject": "Team Meeting Tomorrow at 10 AM",
        "body": "Hi everyone,\n\nJust a reminder that we have our weekly team sync tomorrow at 10 AM in the main conference room. Please come prepared with your weekly updates.\n\nThanks,\nHR Team",
        "priority": "Medium",
        "category": "important",
        "intent": "Meeting reminder requiring attendance preparation",
        "summary": "Weekly team sync scheduled for tomorrow at 10 AM. Attendees should prepare weekly updates.",
        "requires_approval": 1,
        "action_items": [
            "Prepare weekly status update.",
            "Block calendar for 10 AM meeting."
        ],
        "draft_reply": "Subject: Re: Team Meeting Tomorrow at 10 AM\n\nHi HR Team,\n\nThank you for the reminder. I'll be there with my weekly updates ready.\n\nBest regards"
    }
]

# ── Environment Loader ───────────────────────────────────────────────────────

def load_env():
    """Load .env from project root."""
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            eq = line.find('=')
            if eq > 0:
                key = line[:eq].strip()
                val = line[eq+1:].strip()
                os.environ[key] = val

# ── Decryption Helper ────────────────────────────────────────────────────────

def decrypt_password(encrypted_text):
    if not encrypted_text:
        return ""
    if ":" not in encrypted_text:
        return encrypted_text  # Fallback to plaintext if not encrypted
    if not CRYPTOGRAPHY_AVAILABLE:
        print("[Warn] Cryptography module not available. Cannot decrypt password.")
        return encrypted_text
    try:
        secret_key = os.environ.get("ENCRYPTION_KEY", "")
        if not secret_key:
            return encrypted_text
        
        iv_hex, cipher_hex = encrypted_text.split(":", 1)
        iv = bytes.fromhex(iv_hex)
        ciphertext = bytes.fromhex(cipher_hex)
        
        if len(secret_key) == 64:
            try:
                key_bytes = bytes.fromhex(secret_key)
            except ValueError:
                key_bytes = hashlib.sha256(secret_key.encode('utf-8')).digest()
        else:
            key_bytes = hashlib.sha256(secret_key.encode('utf-8')).digest()
            
        cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted_padded = decryptor.update(ciphertext) + decryptor.finalize()
        
        padding_len = decrypted_padded[-1]
        if padding_len < 1 or padding_len > 16:
            return decrypted_padded.decode('utf-8')
        decrypted = decrypted_padded[:-padding_len]
        return decrypted.decode('utf-8')
    except Exception as e:
        print(f"[Decrypt Error] Failed to decrypt: {e}")
        return encrypted_text

# ── Gemini API with Rate-Limit Retry ─────────────────────────────────────────

def generate_with_gemini(api_key, sender, subject, body):
    """Calls Gemini API with exponential backoff on 429 errors."""
    model = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    prompt = f"""You are an intelligent email assistant. Analyze this email and return a JSON response with these fields:
- "priority": "High", "Medium", or "Low"
- "category": classify as one of: "important", "spam", "newsletter", "promotion"
- "intent": A brief phrase describing the sender's intent (e.g., "Request for quote", "Alert notification", "Marketing newsletter")
- "summary": A 2-3 sentence summary
- "action_items": An array of action item strings (empty array if none)
- "draft_reply": A professional reply draft (always generate a polite response, even for newsletters, spam, promotions, or blank/test emails, so the user can test the draft system)
- "requires_approval": true or false. Set to true if the email mentions scheduling a meeting, a call, an appointment, a calendar proposal, or specifies any timeline/date/time to meet (e.g., "let's meet", "are you free at 3pm", "appointment", "schedule a call", "timeline for the project sync", etc.), requiring manual coordination or acceptance from the user. Otherwise, set it to false.

Email:
From: {sender}
Subject: {subject}
Body:
{body}
"""

    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }

    req_body = json.dumps(data).encode('utf-8')

    max_attempts = 5
    base_sleep = 5

    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(url, data=req_body, headers={'Content-Type': 'application/json'})
        try:
            if attempt > 1:
                print(f"[Gemini API] Retry attempt {attempt}/{max_attempts}...")
            else:
                print(f"[Gemini API] Analyzing email from {sender}...")

            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                text = res_data['candidates'][0]['content']['parts'][0]['text'].strip()
                if text.startswith('```json'):
                    text = text[7:]
                if text.endswith('```'):
                    text = text[:-3]
                return json.loads(text.strip())

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"[Gemini API Error] HTTP {e.code}: {error_body[:200]}")

            if e.code == 429:
                sleep_time = base_sleep * (2 ** (attempt - 1))
                match = re.search(r"Please retry in ([0-9.]+)s", error_body)
                if match:
                    suggested = float(match.group(1))
                    sleep_time = max(sleep_time, suggested + 1.0)
                print(f"[Rate Limited] Sleeping {sleep_time:.1f}s before retrying...")
                time.sleep(sleep_time)
            else:
                return None
        except Exception as e:
            print(f"[Gemini API Error] {e}")
            return None

    return None

# ── Excel Logging ────────────────────────────────────────────────────────────

def initialize_excel():
    if not EXCEL_AVAILABLE:
        print("[Warn] openpyxl not installed. Excel logging skipped. Run: pip install openpyxl")
        return
    os.makedirs(os.path.dirname(EXCEL_FILE), exist_ok=True)
    if not os.path.exists(EXCEL_FILE):
        try:
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Email Logs"
            ws.append(["Timestamp", "Email ID", "Sender", "Subject", "Priority", "Category", "Intent", "Status"])
            wb.save(EXCEL_FILE)
            print(f"[OK] Created Excel logs: {EXCEL_FILE}")
        except Exception as e:
            print(f"[Error] Excel init failed: {e}")

def log_to_excel(email_id, sender, subject, priority, category, intent, status):
    if not EXCEL_AVAILABLE or not os.path.exists(EXCEL_FILE):
        return
    try:
        wb = openpyxl.load_workbook(EXCEL_FILE)
        ws = wb.active
        ws.append([datetime.now().strftime("%Y-%m-%d %H:%M:%S"), email_id, sender, subject, priority, category, intent, status])
        wb.save(EXCEL_FILE)
        print(f"[Excel] Logged email {email_id}")
    except Exception as e:
        print(f"[Excel Error] {e}")

def get_existing_email_id(sender, subject, body):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        body_snippet = body[:100] if body else ""
        c.execute("SELECT id FROM emails WHERE sender = ? AND subject = ? AND body LIKE ?", (sender, subject, body_snippet + '%'))
        row = c.fetchone()
        conn.close()
        return row[0] if row else None
    except Exception as e:
        print(f"[DB Error checking existence] {e}")
        return None

# ── Database Insert ──────────────────────────────────────────────────────────

def insert_email_to_db(email, user_id=1, imap_account_id=None):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        
        # Ensure column exists
        try:
            c.execute("ALTER TABLE emails ADD COLUMN requires_approval INTEGER DEFAULT 0")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE emails ADD COLUMN imap_account_id INTEGER")
            conn.commit()
        except sqlite3.OperationalError:
            pass
            
        received_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        
        requires_approval = email.get("requires_approval", 0)
        
        # If it requires approval (e.g. contains scheduling/timeline), do not set auto-send timer
        if requires_approval:
            send_at = None
        else:
            send_at = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat().replace('+00:00', 'Z') if email.get("draft_reply") else None
            
        action_items_str = json.dumps(email.get("action_items", []))

        c.execute('''
            INSERT INTO emails (user_id, sender, subject, body, received_at, priority, status, category, intent, summary, action_items, draft_reply, send_at, requires_approval, imap_account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            user_id,
            email["sender"],
            email["subject"],
            email.get("body", ""),
            received_at,
            email.get("priority", "Medium"),
            "Pending",
            email.get("category", "important"),
            email.get("intent", ""),
            email.get("summary", ""),
            action_items_str,
            email.get("draft_reply", ""),
            send_at,
            requires_approval,
            imap_account_id
        ))

        eid = c.lastrowid

        # Insert action items as tasks
        action_items = email.get("action_items", [])
        for item in action_items:
            c.execute('''
                INSERT INTO tasks (user_id, email_id, title, description, status, priority, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (user_id, eid, item, f"Action item extracted from email: '{email['subject']}'", 'To Do', email.get("priority", "Medium"), received_at))

        conn.commit()
        conn.close()
        print(f"[DB] Inserted email {eid} from {email['sender']} [Category: {email.get('category', 'unknown')}] and created {len(action_items)} tasks")
        return eid
    except Exception as e:
        print(f"[DB Error] {e}")
        return None

# ── Simulation Mode ──────────────────────────────────────────────────────────

def run_simulation():
    print("\n--- Running AI Email Agent Simulation ---")
    initialize_excel()
    for mock in MOCK_EMAILS:
        print(f"\n[Ingesting] Email from: {mock['sender']} [{mock['category']}]")
        time.sleep(0.5)
        eid = insert_email_to_db(mock)
        if eid:
            log_to_excel(eid, mock["sender"], mock["subject"], mock["priority"], mock.get("category", ""), mock.get("intent", ""), "Pending")
    print("\n[OK] Simulation complete. Emails ready on dashboard.")

# ── Real IMAP Agent ──────────────────────────────────────────────────────────

def run_real_agent(imap_server, imap_user, imap_pass, llm_api_key, user_id=1, imap_account_id=None):
    if not IMAP_AVAILABLE:
        print("[Error] imapclient not installed. Run: pip install imapclient")
        return
    if not llm_api_key or llm_api_key == "your_gemini_api_key_here":
        print("[Error] Valid GEMINI_API_KEY required. Check settings page or .env.")
        return

    print(f"\n--- Starting AI Email Agent for {imap_user} ({imap_server}) ---")
    initialize_excel()

    try:
        print(f"[IMAP] Connecting to {imap_server}...")
        with IMAPClient(imap_server, ssl=True) as client:
            client.login(imap_user, imap_pass)
            print(f"[IMAP] Login successful for {imap_user}!")
            client.select_folder('INBOX')

            unseen_messages = client.search('UNSEEN')
            all_messages = client.search('ALL')
            recent_all = all_messages[-10:] if len(all_messages) > 10 else all_messages
            
            # Combine unseen and recent messages, keeping order (unseen first) and avoiding duplicates
            messages = list(dict.fromkeys(unseen_messages + recent_all))
            print(f"[IMAP] Found {len(unseen_messages)} unread and {len(recent_all)} recent messages. Total to sync: {len(messages)}")

            for msg_id in messages:
                response = client.fetch(msg_id, ['ENVELOPE', 'RFC822'])
                data = response[msg_id]
                envelope = data[b'ENVELOPE']

                # Parse sender
                sender_addr = "unknown@example.com"
                if envelope.from_:
                    f = envelope.from_[0]
                    mailbox = f.mailbox.decode('utf-8', errors='ignore') if f.mailbox else ""
                    host = f.host.decode('utf-8', errors='ignore') if f.host else ""
                    sender_addr = f"{mailbox}@{host}"

                # Parse subject
                subject = "No Subject"
                if envelope.subject:
                    subject = envelope.subject.decode('utf-8', errors='ignore')

                # Parse body robustly using email library
                raw_bytes = data.get(b'RFC822', b'')
                body = ""
                try:
                    msg = email_module.message_from_bytes(raw_bytes)
                    if msg.is_multipart():
                        for part in msg.walk():
                            content_type = part.get_content_type()
                            content_disposition = str(part.get("Content-Disposition"))
                            if content_type == "text/plain" and "attachment" not in content_disposition:
                                body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                                break
                            elif content_type == "text/html" and not body and "attachment" not in content_disposition:
                                html_content = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                                body = re.sub('<[^<]+?>', '', html_content)
                    else:
                        body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
                except Exception as ex:
                    print(f"[Parser Warning] Error parsing MIME body: {ex}")
                    body = data.get(b'RFC822.TEXT', b'').decode('utf-8', errors='ignore')

                # Fallback if body is empty
                if not body.strip():
                    body = "Empty body."

                # Check if this email already exists in our database
                existing_id = get_existing_email_id(sender_addr, subject, body)
                if existing_id:
                    print(f"\n[Skip] Email from {sender_addr}: '{subject}' already processed (ID: {existing_id})")
                    if msg_id in unseen_messages:
                        client.add_flags(msg_id, '\\Seen')
                        print(f"[IMAP] Marked unseen email {msg_id} as Read.")
                    continue

                print(f"\n[Processing] {sender_addr}: {subject}")

                insights = generate_with_gemini(llm_api_key, sender_addr, subject, body)

                if insights:
                    processed = {
                        "sender": sender_addr,
                        "subject": subject,
                        "body": body[:4000],
                        "priority": insights.get("priority", "Medium"),
                        "category": insights.get("category", "important"),
                        "intent": insights.get("intent", ""),
                        "summary": insights.get("summary", ""),
                        "action_items": insights.get("action_items", []),
                        "draft_reply": insights.get("draft_reply", ""),
                        "requires_approval": 1 if insights.get("requires_approval") else 0
                    }
                    eid = insert_email_to_db(processed, user_id, imap_account_id)
                    if eid:
                        log_to_excel(eid, sender_addr, subject, processed["priority"], processed["category"], processed["intent"], "Pending")
                        client.add_flags(msg_id, '\\Seen')
                        print(f"[IMAP] Marked email {msg_id} as Read.")
                else:
                    print(f"[Error] AI analysis failed for email {msg_id}")

                time.sleep(1.0)

            print(f"[OK] Inbox processing completed for {imap_user}.")

    except Exception as e:
        print(f"[Error for user {imap_user}] {e}")

# ── Database Settings Loader ─────────────────────────────────────────────────

def load_db_settings():
    settings = {}
    if not os.path.exists(DB_FILE):
        return settings
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
        if c.fetchone():
            c.execute("SELECT key, value FROM settings")
            for row in c.fetchall():
                if row[1]:
                    settings[row[0]] = row[1]
        conn.close()
    except Exception as e:
        print(f"[DB Warning] {e}")
    return settings

# ── Main Entry Point ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Email Automation Background Agent")
    parser.add_argument('--simulate', action='store_true', help="Run simulation with mock emails once and exit")
    parser.add_argument('--loop', action='store_true', help="Run in a continuous 30-second loop")
    args = parser.parse_args()

    load_env()

    if args.simulate:
        run_simulation()
        return

    # Helper function to perform a single sync cycle
    def do_sync_cycle():
        db_settings = load_db_settings()

        db_key_enc = db_settings.get("gemini_api_key")
        db_key = decrypt_password(db_key_enc) if db_key_enc else None
        env_key = os.environ.get("GEMINI_API_KEY")
        llm_api_key = db_key if (db_key and not db_key.startswith("test-key") and not db_key.startswith("•••")) else env_key
        env_model = db_settings.get("gemini_model") or os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")

        if env_model:
            os.environ["GEMINI_MODEL"] = env_model

        users_to_process = []
        if os.path.exists(DB_FILE):
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='imap_accounts'")
                if c.fetchone():
                    c.execute("SELECT id, user_id, email, imap_server, imap_user, imap_password FROM imap_accounts")
                    for row in c.fetchall():
                        acc_id, u_id, u_email, u_server, u_user, u_pass = row
                        u_pass_decrypted = decrypt_password(u_pass) if u_pass else ""
                        if u_server and u_user and u_pass_decrypted:
                            users_to_process.append({
                                "id": u_id,
                                "account_id": acc_id,
                                "email": u_email,
                                "imap_server": u_server,
                                "imap_user": u_user,
                                "imap_password": u_pass_decrypted
                            })
                conn.close()
            except Exception as e:
                print(f"[DB Error fetching IMAP accounts] {e}")

        # Fallback to global setting if no users in DB have IMAP configured
        if not users_to_process:
            g_server = db_settings.get("imap_server") or os.environ.get("IMAP_SERVER")
            g_user = db_settings.get("imap_user") or os.environ.get("IMAP_USER")
            g_pass_enc = db_settings.get("imap_password") or os.environ.get("IMAP_PASSWORD")
            g_pass = decrypt_password(g_pass_enc) if g_pass_enc else ""
            if g_server and g_user and g_pass:
                users_to_process.append({
                    "id": 1,
                    "account_id": None,
                    "email": g_user,
                    "imap_server": g_server,
                    "imap_user": g_user,
                    "imap_password": g_pass
                })

        if not users_to_process:
            print("[Info] No active IMAP credentials found. Please configure settings on the dashboard.")
        else:
            if not llm_api_key or llm_api_key == "your_gemini_api_key_here":
                print("[Warn] GEMINI_API_KEY is not set. Cannot process real emails without Gemini LLM Key.")
            else:
                # Sync for each user
                for user in users_to_process:
                    run_real_agent(user["imap_server"], user["imap_user"], user["imap_password"], llm_api_key, user["id"], user["account_id"])

    if args.loop:
        print("AI Email Automation Background Agent started. Sync loop running every 30s...")
        while True:
            try:
                do_sync_cycle()
            except Exception as e:
                print(f"[Agent Loop Error] {e}")
            time.sleep(30)
    else:
        print("AI Email Automation Agent: running single sync cycle...")
        do_sync_cycle()

if __name__ == "__main__":
    main()
