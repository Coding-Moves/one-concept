from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.config import Settings
from app.schemas.editorial import InviteInput, ProfileInput
from app.services.editorial_invites import invitation_redirect, invite_auth_user


def config(**overrides):
    return Settings(
        _env_file=None,
        **{
            "environment": "production",
            "database_url": "postgresql://unused",
            "supabase_url": "https://test.invalid",
            "supabase_jwks_url": "https://test.invalid/jwks",
            "supabase_service_role_key": "test-server-secret",
            "allowed_origins": "https://review.example.invalid",
            "editorial_invite_redirect_url": "https://review.example.invalid/auth/callback",
            **overrides,
        },
    )


@pytest.mark.parametrize(
    "url",
    [
        "",
        "http://review.example.invalid/auth/callback",
        "https://other.invalid/callback",
        "https://user:password@review.example.invalid/callback",
        "https://review.example.invalid/callback#token",
        "https://review.example.invalid/callback?next=https://other.invalid",
    ],
)
def test_invitation_redirect_is_fixed_and_allowlisted(url):
    with pytest.raises(HTTPException) as exc:
        invitation_redirect(config(editorial_invite_redirect_url=url))
    assert exc.value.status_code == 503


def test_local_callback_only_in_development():
    settings = config(
        environment="development",
        allowed_origins="http://localhost:5173",
        editorial_invite_redirect_url="http://localhost:5173/auth/callback",
    )
    assert invitation_redirect(settings) == settings.editorial_invite_redirect_url
    with pytest.raises(HTTPException):
        invitation_redirect(settings.model_copy(update={"environment": "production"}))


async def test_invite_adapter_uses_server_credentials_and_no_password(monkeypatch):
    import app.services.editorial_invites as service

    uid = uuid4()

    def provider(request):
        assert request.url.path == "/auth/v1/invite"
        assert (
            request.url.params["redirect_to"] == config().editorial_invite_redirect_url
        )
        assert request.headers["authorization"] == "Bearer test-server-secret"
        assert request.headers["apikey"] == "test-server-secret"
        import json

        assert json.loads(request.content) == {"email": "reviewer@example.invalid"}
        return httpx.Response(
            200, json={"id": str(uid), "email": "reviewer@example.invalid"}
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        service.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(provider), **kwargs),
    )
    assert await invite_auth_user("reviewer@example.invalid", config()) == uid


@pytest.mark.parametrize(
    "failure", ["timeout", "rate_limit", "redirect", "wrong_identity", "invalid_json"]
)
async def test_provider_failures_are_sanitized(monkeypatch, failure):
    import app.services.editorial_invites as service

    def provider(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private-provider-details", request=request)
        if failure == "rate_limit":
            return httpx.Response(429, text="private-provider-details")
        if failure == "redirect":
            return httpx.Response(
                302,
                headers={"Location": "https://other.invalid/private-provider-details"},
            )
        if failure == "invalid_json":
            return httpx.Response(200, text="private-provider-details")
        return httpx.Response(
            200, json={"id": str(uuid4()), "email": "wrong@example.invalid"}
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        service.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(provider), **kwargs),
    )
    with pytest.raises(HTTPException) as exc:
        await invite_auth_user("reviewer@example.invalid", config())
    assert exc.value.status_code == 502
    assert "private-provider-details" not in str(exc.value)
    assert "test-server-secret" not in str(exc.value)


def test_profile_and_capabilities_are_validated():
    assert (
        ProfileInput(
            expected_version=1, registered_name="  Muhammad  Ali  "
        ).registered_name
        == "Muhammad Ali"
    )
    assert (
        ProfileInput(expected_version=1, registered_name="معاویہ امیر").registered_name
        == "معاویہ امیر"
    )
    for name in ("x", "\u202eforged", "hidden\x00name", " " * 3):
        with pytest.raises(ValidationError):
            ProfileInput(expected_version=1, registered_name=name)
    with pytest.raises(ValidationError):
        InviteInput(email="reviewer@example.invalid", capabilities=["super_admin"])


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://*.example.invalid",
        "http://review.example.invalid",
        "https://review.example.invalid/path",
        "https://review.example.invalid?next=x",
        "",
    ],
)
def test_enabled_editorial_requires_explicit_secure_origins(origin):
    with pytest.raises(ValidationError) as exc:
        config(editorial_enabled=True, allowed_origins=origin)
    assert "test-server-secret" not in str(exc.value)


async def test_malformed_callback_is_configuration_error():
    with pytest.raises(HTTPException) as exc:
        invitation_redirect(config(editorial_invite_redirect_url="https://[invalid"))
    assert exc.value.status_code == 503
