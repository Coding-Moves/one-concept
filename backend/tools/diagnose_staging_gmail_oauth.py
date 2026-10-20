"""Check staging Gmail OAuth credentials without sending or logging a message.

Only a small allowlist of Google's error codes is printed. Never print a token,
client credential, response body, exception, or recipient address.
"""

import http.client
import json
import os
import re
import sys
from urllib.parse import urlencode

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, PROJECT_REF
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, PROJECT_REF


GOOGLE_ERRORS = frozenset({
    "invalid_client", "invalid_grant", "invalid_request", "unauthorized_client",
    "access_denied", "unsupported_grant_type", "temporarily_unavailable",
})
SCOPE = "https://www.googleapis.com/auth/gmail.send"
CLIENT_ID = re.compile(r"[A-Za-z0-9_-]+\.apps\.googleusercontent\.com\Z")


def credential_shape(credentials: dict[str, str]) -> str | None:
    """Report only the field with a likely copy/paste error, never its value."""
    client_id = credentials["client_id"]
    if not CLIENT_ID.fullmatch(client_id):
        return "client_id_format"
    for field in ("client_secret", "refresh_token"):
        value = credentials[field]
        if any(char.isspace() for char in value) or value.startswith(('"', "'")) or \
           value.endswith(('"', "'")):
            return f"{field}_format"
    return None


def main(*, format_only: bool = False) -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    credentials = {
        "client_id": os.environ.get("STAGING_CANARY_GMAIL_CLIENT_ID", ""),
        "client_secret": os.environ.get("STAGING_CANARY_GMAIL_CLIENT_SECRET", ""),
        "refresh_token": os.environ.get("STAGING_CANARY_GMAIL_REFRESH_TOKEN", ""),
    }
    if staging != DEMO_PROJECT_REF or not PROJECT_REF.fullmatch(production) or \
       staging == production or any(not value or "\n" in value or "\r" in value
                                    for value in credentials.values()):
        print("Staging Gmail OAuth check refused: target or credentials missing", file=sys.stderr)
        return 2
    shape = credential_shape(credentials)
    if shape:
        print(f"Staging Gmail OAuth: {shape}", file=sys.stderr)
        return 2
    if format_only:
        print("Staging Gmail OAuth: credential_format_ok")
        return 0

    connection = http.client.HTTPSConnection("oauth2.googleapis.com", timeout=10)
    try:
        body = urlencode({"grant_type": "refresh_token", **credentials})
        connection.request("POST", "/token", body=body,
                           headers={"Content-Type": "application/x-www-form-urlencoded"})
        response = connection.getresponse()
        payload = json.loads(response.read(8192))
        if not isinstance(payload, dict):
            raise ValueError("Unexpected OAuth response")
        if response.status == 200:
            if not isinstance(payload.get("access_token"), str) or \
               not payload["access_token"]:
                print("Staging Gmail OAuth: invalid_response", file=sys.stderr)
                return 1
            scopes = payload.get("scope")
            if isinstance(scopes, str) and SCOPE not in scopes.split():
                print("Staging Gmail OAuth: gmail_send_scope_missing", file=sys.stderr)
                return 1
            print("Staging Gmail OAuth: token_exchange_ok")
            return 0
        error = payload.get("error")
        code = error if isinstance(error, str) and error in GOOGLE_ERRORS else "other_rejection"
        print(f"Staging Gmail OAuth: {code}", file=sys.stderr)
        return 1
    except (OSError, ValueError, http.client.HTTPException):
        print("Staging Gmail OAuth: transport_or_response_error", file=sys.stderr)
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main(format_only="--format-only" in sys.argv[1:]))
