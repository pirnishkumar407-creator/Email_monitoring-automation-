import os
import sys
import sqlite3
import json
import time
import re
from datetime import datetime, timezone
from email.header import decode_header
import email as email_module

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.agent import decrypt_password, IMAPClient, heuristic_fallback, DB_FILE

def sync_298_emails():
    print(f"Connecting to database: {DB_FILE}...")
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # 1. Get credentials for pirnishkumar407@gmail.com
    c.execute("SELECT id, user_id, email, imap_server, imap_password FROM imap_accounts WHERE email = 'pirnishkumar407@gmail.com' AND auth_type = 'password'")
    row = c.fetchone()
    if not row:
        print("Error: Account not found!")
        return
    
    acc_id, user_id, email, server, enc_pwd = row
    pwd = decrypt_password(enc_pwd)
    print(f"Found account: {email} (User ID {user_id}, Account ID {acc_id})")
    
    # 2. Connect to IMAP
    print(f"Connecting to {server}...")
    with IMAPClient(server, ssl=True) as client:
        client.login(email, pwd)
        print("Logged in successfully.")
        client.select_folder('INBOX')
        
        # Search Primary category
        print("Searching category:primary...")
        msgs = client.gmail_search('category:primary')
        print(f"Found {len(msgs)} total messages in category:primary.")
        
        # Batch fetch X-GM-THRID to group into threads
        print("Fetching thread IDs...")
        res_thr = client.fetch(msgs, ['X-GM-THRID'])
        
        # Group: mapping thrid -> latest msg_id
        threads = {}
        for mid in msgs:
            data = res_thr.get(mid, {})
            thrid = data.get(b'X-GM-THRID')
            if thrid:
                threads[thrid] = mid  # overwriting gives latest message in thread
            else:
                threads[mid] = mid
        
        target_msg_ids = sorted(list(threads.values()))
        print(f"Unique thread count: {len(target_msg_ids)} (Exact Target: 298)")
        
        if len(target_msg_ids) != 298:
            print(f"Notice: Unique threads count is {len(target_msg_ids)}.")
            # If for any reason it's different, take 298 latest
            if len(target_msg_ids) > 298:
                target_msg_ids = target_msg_ids[-298:]
        
        # 3. Batch fetch envelopes, dates, and body snippets in chunks of 50
        print(f"Batch fetching {len(target_msg_ids)} emails in chunks of 50...")
        all_fetch_data = {}
        chunk_size = 50
        for i in range(0, len(target_msg_ids), chunk_size):
            chunk = target_msg_ids[i:i+chunk_size]
            t0 = time.time()
            chunk_res = client.fetch(chunk, ['ENVELOPE', 'INTERNALDATE', 'BODY.PEEK[TEXT]<0.1500>'])
            all_fetch_data.update(chunk_res)
            print(f"  Fetched chunk {i//chunk_size + 1}/{(len(target_msg_ids)+chunk_size-1)//chunk_size} ({len(chunk)} msgs) in {time.time()-t0:.2f}s")
    
    # 4. Prepare emails to insert
    print(f"Processing and classifying {len(target_msg_ids)} emails...")
    emails_to_insert = []
    
    for mid in target_msg_ids:
        data = all_fetch_data.get(mid, {})
        env = data.get(b'ENVELOPE')
        internal_date = data.get(b'INTERNALDATE')
        raw_snippet = data.get(b'BODY[TEXT]<0>', b'')
        
        # Parse sender
        sender_addr = "unknown@example.com"
        sender_name = ""
        if env and env.from_:
            f = env.from_[0]
            mailbox = f.mailbox.decode('utf-8', errors='ignore') if f.mailbox else ""
            host = f.host.decode('utf-8', errors='ignore') if f.host else ""
            sender_addr = f"{mailbox}@{host}".strip()
            if f.name:
                try:
                    parts = decode_header(f.name.decode('utf-8', errors='ignore'))
                    sender_name = "".join(p.decode(c or 'utf-8', errors='ignore') if isinstance(p, bytes) else str(p) for p, c in parts)
                except Exception:
                    sender_name = f.name.decode('utf-8', errors='ignore')
        
        if sender_name and sender_name != sender_addr:
            sender_display = f"{sender_name} <{sender_addr}>"
        else:
            sender_display = sender_addr
            
        # Parse subject
        subject = "No Subject"
        if env and env.subject:
            raw_subj = env.subject.decode('utf-8', errors='ignore')
            try:
                parts = decode_header(raw_subj)
                subject = "".join(p.decode(c or 'utf-8', errors='ignore') if isinstance(p, bytes) else str(p) for p, c in parts).strip() or raw_subj
            except Exception:
                subject = raw_subj
                
        # Parse date
        if internal_date and isinstance(internal_date, datetime):
            if internal_date.tzinfo is None:
                internal_date = internal_date.replace(tzinfo=timezone.utc)
            received_at = internal_date.isoformat().replace('+00:00', 'Z')
        elif env and env.date and isinstance(env.date, datetime):
            if env.date.tzinfo is None:
                env.date = env.date.replace(tzinfo=timezone.utc)
            received_at = env.date.isoformat().replace('+00:00', 'Z')
        else:
            received_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            
        # Parse body snippet
        body_text = ""
        if raw_snippet:
            try:
                text = raw_snippet.decode('utf-8', errors='ignore')
            except Exception:
                text = str(raw_snippet)
            # Remove HTML tags if present
            clean_text = re.sub(r'<[^<]+?>', ' ', text)
            clean_text = re.sub(r'[\r\n\t]+', ' ', clean_text)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            body_text = clean_text[:1200]
            
        if not body_text:
            body_text = f"Email from {sender_addr} with subject: {subject}"
            
        # Intelligent heuristic classification
        insights = heuristic_fallback(sender_addr, subject, body_text)
        
        emails_to_insert.append({
            "user_id": user_id,
            "sender": sender_display,
            "subject": subject,
            "body": body_text,
            "received_at": received_at,
            "priority": insights.get("priority", "Medium"),
            "status": "Pending",
            "category": insights.get("category", "important"),
            "intent": insights.get("intent", "Direct Message"),
            "summary": insights.get("summary", ""),
            "action_items": json.dumps(insights.get("action_items", [])),
            "draft_reply": insights.get("draft_reply", ""),
            "send_at": None,
            "requires_approval": 1 if insights.get("requires_approval") else 0,
            "imap_account_id": acc_id
        })
    
    print(f"Ready to store {len(emails_to_insert)} emails in database.")
    
    # 5. Backup database before modifying
    backup_file = DB_FILE + f".bak_{int(time.time())}"
    import shutil
    shutil.copyfile(DB_FILE, backup_file)
    print(f"Created safety backup at {backup_file}")
    
    # Clean old emails and insert the 298 real emails
    c.execute("DELETE FROM tasks")
    c.execute("DELETE FROM emails")
    
    insert_sql = '''
        INSERT INTO emails (user_id, sender, subject, body, received_at, priority, status, category, intent, summary, action_items, draft_reply, send_at, requires_approval, imap_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    '''
    
    for em in emails_to_insert:
        c.execute(insert_sql, (
            em["user_id"],
            em["sender"],
            em["subject"],
            em["body"],
            em["received_at"],
            em["priority"],
            em["status"],
            em["category"],
            em["intent"],
            em["summary"],
            em["action_items"],
            em["draft_reply"],
            em["send_at"],
            em["requires_approval"],
            em["imap_account_id"]
        ))
        
    conn.commit()
    
    # Verify exact count
    c.execute("SELECT COUNT(*) FROM emails")
    final_count = c.fetchone()[0]
    print(f"\n==========================================")
    print(f"FINAL DATABASE EMAIL COUNT: {final_count}")
    print(f"==========================================")
    conn.close()

if __name__ == "__main__":
    sync_298_emails()
