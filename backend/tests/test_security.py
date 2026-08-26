"""Token verification tests.

These run entirely offline: we mint an ES256 keypair, serve it as a JWKS, and
sign our own tokens. That lets us assert the failure paths — expiry, wrong
audience, algorithm confusion, unknown key — which we could never trigger
reliably with real Supabase tokens.
"""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app.core.security import JwksCache, verify_token

ISSUER = "https://example.supabase.co/auth/v1"
KID = "test-key-1"


def _keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


def _jwks_cache_with(public_key, kid=KID) -> JwksCache:
    cache = JwksCache("https://example.invalid/jwks")
    cache._keys = {kid: public_key}
    cache._fetched_at = time.monotonic()
    return cache


def _token(private_key, *, kid=KID, alg="ES256", **overrides):
    now = int(time.time())
    claims = {
        "sub": "11111111-1111-4111-8111-111111111111",
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": now + 3600,
        "iat": now,
        "email": "learner@example.com",
    }
    claims.update(overrides)
    return jwt.encode(claims, private_key, algorithm=alg, headers={"kid": kid})


async def test_valid_token_is_accepted():
    private, public = _keypair()
    claims = await verify_token(_token(private), _jwks_cache_with(public), ISSUER)
    assert claims.user_id == "11111111-1111-4111-8111-111111111111"
    assert claims.email == "learner@example.com"


async def test_expired_token_is_rejected():
    private, public = _keypair()
    now = int(time.time())
    token = _token(private, exp=now - 10, iat=now - 3600)
    with pytest.raises(HTTPException) as exc:
        await verify_token(token, _jwks_cache_with(public), ISSUER)
    assert exc.value.status_code == 401


async def test_wrong_audience_is_rejected():
    private, public = _keypair()
    with pytest.raises(HTTPException):
        await verify_token(_token(private, aud="anon"), _jwks_cache_with(public), ISSUER)


async def test_wrong_issuer_is_rejected():
    private, public = _keypair()
    token = _token(private, iss="https://attacker.example/auth/v1")
    with pytest.raises(HTTPException):
        await verify_token(token, _jwks_cache_with(public), ISSUER)


async def test_token_signed_by_another_key_is_rejected():
    _, public = _keypair()
    other_private, _ = _keypair()
    with pytest.raises(HTTPException):
        await verify_token(_token(other_private), _jwks_cache_with(public), ISSUER)


async def test_unknown_key_id_is_rejected():
    private, public = _keypair()
    cache = _jwks_cache_with(public)
    # An unknown kid triggers a refresh against an unreachable URL; the request
    # must fail closed rather than fall through to an unverified accept.
    with pytest.raises(Exception):
        await verify_token(_token(private, kid="rotated-key"), cache, ISSUER)


async def test_alg_none_is_rejected():
    """The classic downgrade: strip the signature and claim no algorithm."""
    _, public = _keypair()
    token = jwt.encode(
        {"sub": "x", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        key="",
        algorithm="none",
        headers={"kid": KID},
    )
    with pytest.raises(HTTPException) as exc:
        await verify_token(token, _jwks_cache_with(public), ISSUER)
    assert exc.value.status_code == 401


async def test_hs256_signed_with_public_key_is_rejected():
    """Algorithm confusion: sign with HS256 using the ES256 public key as the
    HMAC secret. PyJWT refuses to *produce* this, so we assemble it by hand —
    which is exactly what an attacker would do."""
    import base64
    import hashlib
    import hmac
    import json

    from cryptography.hazmat.primitives import serialization

    _, public = _keypair()
    pem = public.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    def b64(raw: bytes) -> bytes:
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    payload = b64(
        json.dumps(
            {
                "sub": "11111111-1111-4111-8111-111111111111",
                "aud": "authenticated",
                "iss": ISSUER,
                "exp": int(time.time()) + 60,
            }
        ).encode()
    )
    signing_input = header + b"." + payload
    signature = b64(hmac.new(pem, signing_input, hashlib.sha256).digest())
    token = (signing_input + b"." + signature).decode()

    with pytest.raises(HTTPException) as exc:
        await verify_token(token, _jwks_cache_with(public), ISSUER)
    assert exc.value.status_code == 401

async def test_missing_subject_is_rejected():
    private, public = _keypair()
    now = int(time.time())
    token = jwt.encode(
        {"aud": "authenticated", "iss": ISSUER, "exp": now + 60},
        private,
        algorithm="ES256",
        headers={"kid": KID},
    )
    with pytest.raises(HTTPException):
        await verify_token(token, _jwks_cache_with(public), ISSUER)


async def test_garbage_token_is_rejected():
    _, public = _keypair()
    with pytest.raises(HTTPException):
        await verify_token("not-a-token", _jwks_cache_with(public), ISSUER)
