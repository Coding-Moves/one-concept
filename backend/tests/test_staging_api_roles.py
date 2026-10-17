"""Staging role checks must reject identity confusion and hide provider data."""

import io
import urllib.error

import pytest

from tools import staging_api_roles


def test_bootstrap_rejects_duplicate_identities_before_sql(monkeypatch):
    user = "b5a94932-62e0-4780-91c7-af48b93e27ab"
    monkeypatch.setattr(staging_api_roles, "staging_sql",
                        lambda *_args: pytest.fail("SQL must not run"))
    with pytest.raises(staging_api_roles.ProbeFailure, match="distinct"):
        staging_api_roles.bootstrap_owner({}, user, user, user)


def test_api_error_reports_only_fixed_label_and_status(monkeypatch):
    def fail(*_args, **_kwargs):
        raise urllib.error.HTTPError("https://private.invalid/path", 503,
                                     "private upstream message", {}, io.BytesIO(b"secret body"))

    monkeypatch.setattr(staging_api_roles.urllib.request, "urlopen", fail)
    with pytest.raises(staging_api_roles.ProbeFailure) as error:
        staging_api_roles.api_call("https://private.invalid/path", label="owner profile",
                                   key="private-key", token="private-jwt")
    assert str(error.value) == "owner profile: HTTP 503, expected 200"


def test_role_probe_refuses_production_before_sign_in(monkeypatch, capsys):
    monkeypatch.setenv("STAGING_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", "private-connection")
    monkeypatch.setattr(staging_api_roles, "sign_in",
                        lambda *_args: pytest.fail("Auth must not be called"))
    assert staging_api_roles.run() == 1
    assert "private-connection" not in capsys.readouterr().err


def test_public_profile_probe_disables_share_and_checks_revoked_token(monkeypatch):
    token = "a" * 43
    calls = []

    def fake_api(url, **kwargs):
        calls.append((url, kwargs))
        if kwargs["label"] == "private sharing settings":
            return {"enabled": False, "version": 0}
        if kwargs["label"] == "enable private-field test":
            return {"enabled": True, "version": 1, "public_path": f"/p/{token}"}
        if kwargs["label"] == "anonymous public profile":
            return {"achievements": []}
        if kwargs["label"] == "disable public profile":
            return {"enabled": False, "version": 2}
        assert kwargs["label"] == "revoked public link"
        assert kwargs["expected"] == 404
        return None

    monkeypatch.setattr(staging_api_roles, "api_call", fake_api)
    staging_api_roles.check_public_profile_privacy("https://staging.invalid", "public", "jwt")
    assert len(calls) == 5
    assert calls[2][1].get("token") is None
    assert calls[3][1]["body"] == {"version": 1, "enabled": False}
