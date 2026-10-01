"""Small Supabase Admin API adapter. Only invitations, never password handling."""

from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import HTTPException

from app.config import Settings


def invitation_redirect(settings: Settings) -> str:
    value = settings.editorial_invite_redirect_url
    parts = urlsplit(value)
    origin = f"{parts.scheme}://{parts.netloc}"
    local = parts.hostname in ("localhost", "127.0.0.1") and not settings.is_production
    if (
        not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or (parts.scheme != "https" and not (local and parts.scheme == "http"))
        or origin not in settings.cors_origins
    ):
        raise HTTPException(
            503, "Configure an exact permitted editorial invitation callback"
        )
    return value


async def invite_auth_user(email: str, settings: Settings) -> UUID:
    redirect = invitation_redirect(settings)
    if not settings.supabase_service_role_key:
        raise HTTPException(503, "Editorial invitation provider is not configured")
    key = settings.supabase_service_role_key
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.post(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/invite",
                params={"redirect_to": redirect},
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                json={"email": email},
            )
        response.raise_for_status()
        result = response.json()
        # Supabase GoTrue /invite returns the user object, not its session.
        if result.get("email", "").lower() != email:
            raise ValueError("Unexpected invitation identity")
        return UUID(result["id"])
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        # Provider bodies/URLs may contain sensitive data. Do not echo or log
        # them; the operator can check Auth delivery logs separately.
        raise HTTPException(
            502, "Invitation not confirmed; inspect Auth before retrying"
        ) from None
