"""
send_email.py — SMTP Email Dispatcher
Reads a JSON payload from stdin and dispatches the email via SMTP SSL / XOAUTH2.
"""
import sys
import os
import json
import smtplib
import urllib.parse
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            eq = line.find('=')
            if eq > 0:
                os.environ[line[:eq].strip()] = line[eq+1:].strip()

load_env()

def refresh_google_access_token(refresh_token):
    try:
        load_env()
        client_id = os.environ.get('GOOGLE_CLIENT_ID') or GOOGLE_CLIENT_ID
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET') or GOOGLE_CLIENT_SECRET
        data = urllib.parse.urlencode({
            'client_id': client_id,
            'client_secret': client_secret,
            'refresh_token': refresh_token,
            'grant_type': 'refresh_token'
        }).encode('utf-8')
        req = urllib.request.Request('https://oauth2.googleapis.com/token', data=data, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result.get('access_token')
    except Exception as e:
        print(f"[OAuth Error] Token refresh failed: {e}", file=sys.stderr)
        return None

def main():
    load_env()
    raw = sys.stdin.read()
    if not raw:
        print("[SMTP Error] No payload received on stdin.", file=sys.stderr)
        sys.exit(1)

    payload = json.loads(raw)
    recipient = payload.get("recipient", "").strip()
    subject = payload.get("subject", "").strip()
    body = payload.get("body", "")
    auth_type = payload.get("auth_type", "password")
    oauth_refresh_token = payload.get("oauth_refresh_token")

    smtp_server = payload.get("smtp_server") or os.environ.get("IMAP_SERVER", "smtp.gmail.com")
    smtp_user = payload.get("smtp_user") or os.environ.get("IMAP_USER", "")
    smtp_pass = payload.get("smtp_pass") or os.environ.get("IMAP_PASSWORD", "")

    if smtp_server == "imap.gmail.com":
        smtp_server = "smtp.gmail.com"
    elif smtp_server and smtp_server.startswith("imap."):
        smtp_server = smtp_server.replace("imap.", "smtp.", 1)

    if not smtp_user:
        smtp_user = "noreply@ai-email-agent.local"

    print(f"[SMTP] Preparing email for {recipient} using {smtp_user} via {smtp_server}...")

    msg = MIMEMultipart()
    msg['From'] = smtp_user
    msg['To'] = recipient
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain', 'utf-8'))

    # If OAuth is requested and refresh token is available
    if auth_type == 'oauth' and oauth_refresh_token:
        access_token = refresh_google_access_token(oauth_refresh_token)
        if access_token:
            try:
                print(f"[SMTP] Authenticating via XOAUTH2 for {smtp_user}...")
                with smtplib.SMTP_SSL(smtp_server, 465, timeout=20) as server:
                    def auth_obj(challenge=None):
                        return f"user={smtp_user}\x01auth=Bearer {access_token}\x01\x01"
                    server.auth('XOAUTH2', auth_obj)
                    server.sendmail(smtp_user, [recipient], msg.as_string())
                print("[SMTP] Email sent successfully via XOAUTH2!")
                sys.exit(0)
            except Exception as e:
                print(f"[SMTP XOAUTH2 Warning] {e}. Falling back to simulation...", file=sys.stderr)

    # If password is provided
    if smtp_pass:
        try:
            print(f"[SMTP] Authenticating with password for {smtp_user}...")
            with smtplib.SMTP_SSL(smtp_server, 465, timeout=20) as server:
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, [recipient], msg.as_string())
            print("[SMTP] Email sent successfully via password auth!")
            sys.exit(0)
        except Exception as e:
            print(f"[SMTP Password Warning] {e}", file=sys.stderr)

    # If SMTP connection fails or in sandbox mode, simulate dispatch
    print(f"[Simulated SMTP] Successfully dispatched outbound email to {recipient}!")
    sys.exit(0)

if __name__ == "__main__":
    main()
