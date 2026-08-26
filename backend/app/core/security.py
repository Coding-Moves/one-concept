"""Supabase access-token verification.

This project signs tokens asymmetrically (ES256), so the backend verifies them
against the project's published JWKS. The signing key never touches this
service, and the legacy shared HS256 secret is not used.
"""

import asyncio
import time
from dataclasses import dataclass

import httpx
import jwt

from app.core.errors import unauthorized

# Only the algorithm the project actually issues. Pinning this is what stops an
# attacker swapping the header to `none`, or to HS256 signed with the public key.
ALLOWED_ALGORITHMS = ["ES256"]


class JwksCache:
    """Caches JWKS keys, and refetches when an unknown key id shows up.

    Supabase rotates signing keys without warning, so a `kid` we have never seen
    is expected rather than exceptional — but it is also what a forged token
    looks like, hence the refetch throttle.
    """

    def __init__(self, url: str, ttl_seconds: int = 3600, min_refresh_seconds: int = 30):
        self._url = url
        self._ttl = ttl_seconds
        self._min_refresh = min_refresh_seconds
        self._keys: dict[str, object] = {}
        self._fetched_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(self._url)
            response.raise_for_status()
            data = response.json()

        keys: dict[str, object] = {}
        for entry in data.get("keys", []):
            kid = entry.get("kid")
            if not kid:
                continue
            try:
                keys[kid] = jwt.PyJWK.from_dict(entry).key
            except Exception:
                # An unsupported key type is not fatal: other keys may still work.
                continue

        self._keys = keys
        self._fetched_at = time.monotonic()

    async def get_key(self, kid: str):
        async with self._lock:
            age = time.monotonic() - self._fetched_at
            stale = age > self._ttl
            if not self._keys or stale:
                await self._refresh()

            if kid not in self._keys and age > self._min_refresh:
                # Possible rotation. Throttled so unknown kids cannot be used to
                # hammer the JWKS endpoint.
                await self._refresh()

            key = self._keys.get(kid)

        if key is None:
            raise unauthorized("Unknown token signing key")
        return key


@dataclass(frozen=True)
class TokenClaims:
    user_id: str
    email: str | None
    expires_at: int


async def verify_token(token: str, jwks: JwksCache, issuer: str) -> TokenClaims:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise unauthorized("Malformed token")

    algorithm = header.get("alg")
    if algorithm not in ALLOWED_ALGORITHMS:
        raise unauthorized("Unsupported token algorithm")

    kid = header.get("kid")
    if not kid:
        raise unauthorized("Token is missing a key id")

    key = await jwks.get_key(kid)

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            audience="authenticated",
            issuer=issuer,
            options={"require": ["exp", "sub"], "verify_aud": True, "verify_iss": True},
        )
    except jwt.ExpiredSignatureError:
        raise unauthorized("Token has expired")
    except jwt.PyJWTError:
        raise unauthorized()

    subject = payload.get("sub")
    if not subject:
        raise unauthorized("Token has no subject")

    return TokenClaims(
        user_id=str(subject),
        email=payload.get("email"),
        expires_at=int(payload["exp"]),
    )
