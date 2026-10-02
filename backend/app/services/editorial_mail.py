"""Gmail HTTPS delivery using the existing account; never logs provider responses."""

import asyncio
import base64
import re
import httpx
from email.message import EmailMessage
from urllib.parse import urlsplit


class DeliveryError(Exception):
    def __init__(self, code, retryable=True):
        self.code, self.retryable = code, retryable
        super().__init__(code)


def setup_status(settings):
    if not settings.editorial_enabled or not settings.editorial_email_enabled:
        return "disabled"
    if settings.is_production and not settings.editorial_email_staging_verified:
        return "staging_verification_required"
    try:
        url = urlsplit(settings.editorial_email_dashboard_url)
    except ValueError:
        return "dashboard_setup_required"
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path not in ("", "/")
        or settings.editorial_email_dashboard_url.rstrip("/")
        not in settings.cors_origins
    ):
        return "dashboard_setup_required"
    if (
        not settings.editorial_gmail_client_id
        or not settings.editorial_gmail_client_secret
        or not settings.editorial_gmail_refresh_token
        or not re.fullmatch(
            r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", settings.editorial_email_from
        )
    ):
        return "sender_setup_required"
    if not settings.is_production and not test_recipients(settings):
        return "test_recipients_required"
    return "ready"


def test_recipients(settings):
    return {
        s.strip().lower()
        for s in settings.editorial_email_test_recipients.split(",")
        if s.strip()
    }


def message(settings, batch):
    msg = EmailMessage()
    msg["From"] = settings.editorial_email_from
    msg["To"] = batch["recipient_email"]
    msg["Subject"] = batch["subject"]
    # Gmail has no documented send idempotency key. This is correlation only.
    msg["Message-ID"] = f"<{batch['id']}@{settings.editorial_email_from.split('@')[1]}>"
    msg.set_content(batch["body"])
    return msg


async def send(settings, batch):
    """Gmail's HTTPS API works without Railway's paid SMTP networking."""
    raw = base64.urlsafe_b64encode(message(settings, batch).as_bytes()).decode("ascii")
    try:
        async with (
            asyncio.timeout(25),
            httpx.AsyncClient(timeout=10, follow_redirects=False) as client,
        ):
            token = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": settings.editorial_gmail_client_id,
                    "client_secret": settings.editorial_gmail_client_secret,
                    "refresh_token": settings.editorial_gmail_refresh_token,
                },
            )
            if token.status_code != 200:
                temporary = token.status_code == 429 or token.status_code >= 500
                raise DeliveryError(
                    "provider_temporary" if temporary else "sender_authorization",
                    temporary,
                )
            access = token.json().get("access_token")
            if not isinstance(access, str) or not access:
                raise DeliveryError("sender_authorization", False)
            response = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": "Bearer " + access},
                json={"raw": raw},
            )
            if response.status_code == 200:
                if not response.json().get("id"):
                    raise DeliveryError("delivery_unknown")
                return
            temporary = response.status_code == 429 or response.status_code >= 500
            if response.status_code == 403:
                reasons = {
                    e.get("reason")
                    for e in response.json().get("error", {}).get("errors", [])
                }
                temporary = bool(
                    reasons
                    & {
                        "rateLimitExceeded",
                        "userRateLimitExceeded",
                        "dailyLimitExceeded",
                    }
                )
            raise DeliveryError(
                "provider_temporary" if temporary else "provider_rejected", temporary
            )
    except (
        httpx.HTTPError,
        TimeoutError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
    ):
        # A timeout after acceptance is ambiguous. Never expose response bodies,
        # access tokens, refresh tokens, or provider request headers in logs.
        raise DeliveryError("delivery_unknown") from None
