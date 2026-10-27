"""Local Smart Mirror server with an optional read-only Gmail connector.

The server binds only to loopback. OAuth credentials are read from environment
variables and access tokens remain in memory for this process only.
"""

from __future__ import annotations

import html
import json
import os
import secrets
import threading
import time
from datetime import datetime
from email.header import decode_header, make_header
from email.utils import parseaddr
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8000"))
REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI", f"http://localhost:{PORT}/oauth/google/callback"
)
CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
STATE_COOKIE = "reflect_gmail_oauth_state"
SESSION_COOKIE = "reflect_gmail_session"
COOKIE_LOCK = threading.RLock()
OAUTH_STATES: dict[str, float] = {}
SESSIONS: dict[str, dict] = {}


class IntegrationError(Exception):
    """A safe, user-facing integration error."""


def _request_json(url: str, *, data: bytes | None = None, headers: dict | None = None) -> dict:
    request = Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urlopen(request, timeout=15) as response:
            payload = response.read(2_000_000)
        return json.loads(payload.decode("utf-8")) if payload else {}
    except HTTPError as exc:
        try:
            details = json.loads(exc.read(4096).decode("utf-8"))
            error_value = details.get("error", {})
            reason = details.get("error_description") or (
                error_value.get("message") if isinstance(error_value, dict) else error_value
            )
        except (ValueError, AttributeError):
            reason = None
        raise IntegrationError(reason or f"Google returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise IntegrationError("Google could not be reached. Check the internet connection and try again.") from exc


def _decode_mime(value: str) -> str:
    try:
        return str(make_header(decode_header(value)))
    except (TypeError, ValueError, LookupError):
        return value


def _get_access_token(session: dict, force_refresh: bool = False) -> str:
    if not force_refresh and session.get("access_token") and session.get("expires_at", 0) > time.time() + 60:
        return session["access_token"]
    refresh_token = session.get("refresh_token")
    if not refresh_token:
        raise IntegrationError("Gmail authorization expired. Connect Gmail again.")
    body = urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode("ascii")
    try:
        token = _request_json(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    except IntegrationError as exc:
        if "invalid_grant" in str(exc).lower():
            raise IntegrationError("Gmail authorization expired or was revoked. Connect Gmail again.") from exc
        raise
    session["access_token"] = token["access_token"]
    session["expires_at"] = time.time() + int(token.get("expires_in", 3600))
    return session["access_token"]


def _gmail_get(session: dict, resource: str, params: dict | None = None, retry: bool = True) -> dict:
    access_token = _get_access_token(session)
    query = f"?{urlencode(params or {}, doseq=True)}" if params else ""
    request = Request(
        f"{GMAIL_API}/{resource}{query}",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = response.read(2_000_000)
        return json.loads(payload.decode("utf-8")) if payload else {}
    except HTTPError as exc:
        if exc.code == 401 and retry:
            _get_access_token(session, force_refresh=True)
            return _gmail_get(session, resource, params, retry=False)
        try:
            details = json.loads(exc.read(4096).decode("utf-8"))
            reason = details.get("error", {}).get("message")
        except (ValueError, AttributeError):
            reason = None
        if exc.code == 403:
            raise IntegrationError("Gmail API access was denied. Check that Gmail API is enabled and read-only access was approved.") from exc
        raise IntegrationError(reason or f"Gmail returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise IntegrationError("Gmail could not be reached. Check the internet connection and try again.") from exc


def _read_latest_inbox(session: dict) -> dict:
    profile = _gmail_get(session, "profile")
    inbox_label = _gmail_get(session, "labels/INBOX")
    listing = _gmail_get(session, "messages", {"q": "in:inbox is:unread", "maxResults": 1})
    message = None
    entries = listing.get("messages") or []
    if entries:
        metadata = _gmail_get(session, f"messages/{quote(entries[0]['id'], safe='')}", {
            "format": "metadata",
            "metadataHeaders": ["From", "Subject"],
        })
        headers = {
            item.get("name", "").lower(): _decode_mime(item.get("value", ""))
            for item in metadata.get("payload", {}).get("headers", [])
        }
        sender_name, sender_email = parseaddr(headers.get("from", ""))
        sender = sender_name or sender_email or "Unknown sender"
        try:
            received = datetime.fromtimestamp(int(metadata.get("internalDate", "0")) / 1000).astimezone()
            received_at = received.strftime("%I:%M %p").lstrip("0")
        except (ValueError, OSError, OverflowError):
            received_at = "Recently"
        snippet = metadata.get("snippet", "").strip()
        message = {
            "sender": sender[:120],
            "subject": (headers.get("subject") or "(No subject)")[:160],
            "snippet": snippet[:240],
            "receivedAt": received_at,
        }
    return {
        "email": profile.get("emailAddress", ""),
        "unread": int(inbox_label.get("messagesUnread", 0)),
        "message": message,
        "refreshedAt": int(time.time()),
    }


class MirrorHandler(SimpleHTTPRequestHandler):
    server_version = "ReflectMirror/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # Avoid logging query strings or any message/authorization data.
        path = urlsplit(self.path).path
        print(f"{self.address_string()} - {fmt % (path, *args[1:])}")

    def list_directory(self, path: str):
        self.send_error(404, "Not found")
        return None

    def _send_json(self, status: int, data: dict, extra_headers: list[tuple[str, str]] | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in extra_headers or []:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status: int, title: str, message: str, extra_headers: list[tuple[str, str]] | None = None) -> None:
        safe_title = html.escape(title)
        safe_message = html.escape(message)
        body = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{safe_title}</title><style>body{{margin:0;padding:8vh 8vw;background:#0b1014;color:#e9efeb;font:16px Segoe UI,sans-serif}}main{{max-width:620px;margin:auto;padding:32px;border:1px solid #33423d;border-radius:14px;background:#151d20}}h1{{color:#a6e5c8}}a{{color:#a6e5c8}}</style>
<main><h1>{safe_title}</h1><p>{safe_message}</p><p><a href="/">Return to Smart Mirror</a></p></main></html>""".encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in extra_headers or []:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _cookie(self, name: str) -> str | None:
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = jar.get(name)
        return morsel.value if morsel else None

    def _session(self) -> tuple[str | None, dict | None]:
        session_id = self._cookie(SESSION_COOKIE)
        if not session_id:
            return None, None
        with COOKIE_LOCK:
            return session_id, SESSIONS.get(session_id)

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin in {f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"}

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/gmail/status":
            if not self._origin_allowed():
                return self._send_json(403, {"error": "Origin is not allowed."})
            _, session = self._session()
            return self._send_json(200, {
                "configured": bool(CLIENT_ID and CLIENT_SECRET),
                "connected": bool(session),
                "email": session.get("email", "") if session else "",
                "refreshSeconds": 60,
            })
        if path == "/api/gmail/inbox":
            if not self._origin_allowed():
                return self._send_json(403, {"error": "Origin is not allowed."})
            _, session = self._session()
            if not session:
                return self._send_json(200, {"configured": bool(CLIENT_ID and CLIENT_SECRET), "connected": False})
            try:
                return self._send_json(200, {"configured": True, "connected": True, **_read_latest_inbox(session)})
            except IntegrationError as exc:
                message = str(exc)
                if "expired" in message.lower() or "revoked" in message.lower():
                    return self._send_json(401, {"configured": True, "connected": False, "error": message})
                return self._send_json(502, {"configured": True, "connected": True, "error": message})
        if path == "/auth/gmail/start":
            return self._start_gmail_oauth()
        if path == "/oauth/google/callback":
            return self._finish_gmail_oauth()
        parts = [part.lower() for part in Path(path).parts if part not in {"/", ".", ".."}]
        file_name = parts[-1] if parts else ""
        if (
            path.endswith(".py")
            or any(part.startswith(".") for part in parts)
            or file_name.startswith(("client_secret", "token", "credentials"))
        ):
            return self.send_error(404, "Not found")
        return super().do_GET()

    def _start_gmail_oauth(self) -> None:
        if not (CLIENT_ID and CLIENT_SECRET):
            return self._send_html(503, "Gmail setup needed", "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as environment variables, then restart app_server.py. Follow the Google OAuth setup in README.md.")
        state = secrets.token_urlsafe(32)
        now = time.time()
        with COOKIE_LOCK:
            for old_state, created in list(OAUTH_STATES.items()):
                if now - created > 600:
                    OAUTH_STATES.pop(old_state, None)
            OAUTH_STATES[state] = now
        params = {
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": GMAIL_SCOPE,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
        self.send_response(302)
        self.send_header("Location", f"{AUTH_URL}?{urlencode(params)}")
        self.send_header("Set-Cookie", f"{STATE_COOKIE}={state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _finish_gmail_oauth(self) -> None:
        query = parse_qs(urlsplit(self.path).query)
        state = query.get("state", [""])[0]
        state_cookie = self._cookie(STATE_COOKIE)
        code = query.get("code", [""])[0]
        if query.get("error"):
            return self._send_html(400, "Gmail was not connected", "Google authorization was cancelled or denied. No mailbox data was read.", [("Set-Cookie", f"{STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")])
        with COOKIE_LOCK:
            issued = OAUTH_STATES.pop(state, None)
        if not code or not state or not state_cookie or not secrets.compare_digest(state, state_cookie) or not issued or time.time() - issued > 600:
            return self._send_html(400, "Connection could not be verified", "The sign-in state was missing or expired. Return to the mirror and try Connect Gmail again.", [("Set-Cookie", f"{STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")])
        form = urlencode({
            "code": code,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        }).encode("ascii")
        try:
            token = _request_json(TOKEN_URL, data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
            access_token = token.get("access_token")
            refresh_token = token.get("refresh_token")
            granted_scopes = token.get("scope", "").split()
            if granted_scopes and GMAIL_SCOPE not in granted_scopes:
                raise IntegrationError("Read-only Gmail access was not granted. Connect Gmail again and approve the requested scope.")
            if not access_token or not refresh_token:
                raise IntegrationError("Google did not return an offline refresh token. Revoke the old app access in your Google Account, then connect again.")
            temporary = {"access_token": access_token, "expires_at": time.time() + int(token.get("expires_in", 3600)), "refresh_token": refresh_token}
            profile = _gmail_get(temporary, "profile")
            email = profile.get("emailAddress", "")
            if not email:
                raise IntegrationError("Google did not return a Gmail address for this account.")
        except IntegrationError as exc:
            return self._send_html(502, "Gmail connection failed", str(exc), [("Set-Cookie", f"{STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")])
        session_id = secrets.token_urlsafe(32)
        with COOKIE_LOCK:
            SESSIONS[session_id] = {**temporary, "email": email}
        self.send_response(302)
        self.send_header("Location", "/#top")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}={session_id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800")
        self.send_header("Set-Cookie", f"{STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/gmail/disconnect":
            return self._send_json(404, {"error": "Not found."})
        if not self._origin_allowed():
            return self._send_json(403, {"error": "Origin is not allowed."})
        session_id, session = self._session()
        if session:
            token = session.get("refresh_token") or session.get("access_token")
            if token:
                try:
                    body = urlencode({"token": token}).encode("ascii")
                    _request_json(REVOKE_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
                except IntegrationError:
                    pass
            with COOKIE_LOCK:
                SESSIONS.pop(session_id, None)
        return self._send_json(200, {"connected": False}, [("Set-Cookie", f"{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")])


def main() -> None:
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), MirrorHandler)
    print(f"Reflect Smart Mirror: http://localhost:{PORT}")
    if CLIENT_ID and CLIENT_SECRET:
        print("Gmail OAuth is configured. Tokens will remain in memory only.")
    else:
        print("Gmail is in demo mode. Follow README.md to configure Google OAuth.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Reflect Smart Mirror.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
