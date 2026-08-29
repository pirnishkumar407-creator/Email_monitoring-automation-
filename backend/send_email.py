"""
send_email.py — SMTP Email Dispatcher
Reads a JSON payload from stdin and sends the email via Gmail SMTP.
"""
import sys
import os
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def load_env():
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
                os.environ[line[:eq].strip()] = line[eq+1:].strip()

def main():
    load_env()

    raw = sys.stdin.read()
    if not raw:
        print("[SMTP Error] No payload received on stdin.", file=sys.stderr)
        sys.exit(1)

    payload = json.loads(raw)
    recipient = payload.get("recipient", "")
    subject = payload.get("subject", "")
    body = payload.get("body", "")

    # Retrieve credentials from payload, fallback to environment
    smtp_server = payload.get("smtp_server") or os.environ.get("IMAP_SERVER", "imap.gmail.com")
    smtp_user = payload.get("smtp_user") or os.environ.get("IMAP_USER", "")
    smtp_pass = payload.get("smtp_pass") or os.environ.get("IMAP_PASSWORD", "")

    # Auto-convert IMAP server addresses to SMTP server addresses for common cases
    if smtp_server == "imap.gmail.com":
        smtp_server = "smtp.gmail.com"
    elif smtp_server and smtp_server.startswith("imap."):
        smtp_server = smtp_server.replace("imap.", "smtp.", 1)

    if not smtp_user or not smtp_pass:
        print("[SMTP Error] SMTP user or password credentials not provided in payload or environment.", file=sys.stderr)
        sys.exit(1)

    print(f"[SMTP] Sending reply to {recipient} using account {smtp_user} via {smtp_server}...")
    print(f"[SMTP] Subject: {subject}")

    msg = MIMEMultipart()
    msg['From'] = smtp_user
    msg['To'] = recipient
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    try:
        with smtplib.SMTP_SSL(smtp_server, 465) as server:
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, recipient, msg.as_string())
        print("[SMTP] Email sent successfully!")
    except Exception as e:
        print(f"[SMTP Error] {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
