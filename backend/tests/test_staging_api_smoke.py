"""Protected staging smoke guards its target and checks contracts without logging tokens."""

import io
import urllib.error

import pytest

from tools import staging_api_smoke


def test_target_rejects_production_and_unreviewed_projects():
    assert staging_api_smoke.target(
        "zhrulokgngjceqgjkcmw", "egdszjoesxlccauahmsx"
    ) == "https://zhrulokgngjceqgjkcmw.supabase.co"
    for staging, production in (
        ("egdszjoesxlccauahmsx", "egdszjoesxlccauahmsx"),
        ("egdszjoesxlccauahmsx", "zhrulokgngjceqgjkcmw"),
        ("wrong", "egdszjoesxlccauahmsx"),
    ):
        with pytest.raises(ValueError):
            staging_api_smoke.target(staging, production)


def test_smoke_checks_authenticated_state_and_does_not_print_secrets(monkeypatch, capsys):
    calls = []
    stats = {"current": 1, "longest": 2, "total_learned": 3, "total_reviews": 0}

    def fake_request(url, **kwargs):
        calls.append((url, kwargs))
        if "/auth/v1/token" in url:
            return {"access_token": "private-jwt", "user": {
                "id": "b5a94932-62e0-4780-91c7-af48b93e27ab"
            }}
        if url.endswith("/v1/me/state?compact=true&reviews=true"):
            return {"followed_topics": ["software-engineering"],
                    "daily_availability": "available", "daily": {
                        "concept": {"slug": "lesson"}
                    }, "assignment_slug": "lesson", "stats": stats}
        if url.endswith("/v1/topics"):
            return [{"slug": "software-engineering"}]
        if url.endswith("/v1/me/stats"):
            return stats
        return {"items": []}

    monkeypatch.setattr(staging_api_smoke, "request_json", fake_request)
    staging_api_smoke.smoke("https://zhrulokgngjceqgjkcmw.supabase.co",
                            "public-key", "test@example.invalid", "private-password")
    assert len(calls) == 5
    assert [call[1]["step"] for call in calls] == [
        "auth sign-in", "learner state", "topics", "statistics", "achievements"
    ]
    assert calls[0][1]["body"] == {"email": "test@example.invalid", "password": "private-password"}
    assert all(call[1].get("token") == "private-jwt" for call in calls[1:])
    assert capsys.readouterr().out == ""


def test_smoke_rejects_inconsistent_assignment(monkeypatch):
    def fake_request(url, **_kwargs):
        if "/auth/v1/token" in url:
            return {"access_token": "jwt", "user": {
                "id": "b5a94932-62e0-4780-91c7-af48b93e27ab"
            }}
        return {"followed_topics": [], "daily_availability": "available",
                "daily": {"concept": {"slug": "wrong"}}, "assignment_slug": "expected"}

    monkeypatch.setattr(staging_api_smoke, "request_json", fake_request)
    with pytest.raises(ValueError, match="assignment pointer"):
        staging_api_smoke.smoke("https://zhrulokgngjceqgjkcmw.supabase.co", "key", "e", "p")


def test_http_failure_reports_only_step_and_status(monkeypatch):
    def fail(_request, **_kwargs):
        raise urllib.error.HTTPError(
            "https://secret.invalid/private", 403, "secret response",
            {}, io.BytesIO(b"private provider body")
        )

    monkeypatch.setattr(staging_api_smoke.urllib.request, "urlopen", fail)
    with pytest.raises(staging_api_smoke.StagingHTTPError) as error:
        staging_api_smoke.request_json("https://secret.invalid/private", step="learner state",
                                       key="private-key", token="private-token")
    assert str(error.value) == "learner state: HTTP 403"


def test_smoke_reports_all_failed_endpoints_without_response_data(monkeypatch):
    calls = []

    def fake_request(url, **kwargs):
        calls.append(kwargs["step"])
        if kwargs["step"] == "auth sign-in":
            return {"access_token": "private-jwt", "user": {
                "id": "b5a94932-62e0-4780-91c7-af48b93e27ab"
            }}
        if kwargs["step"] in {"learner state", "statistics"}:
            raise staging_api_smoke.StagingHTTPError(kwargs["step"], 503)
        return [] if kwargs["step"] == "topics" else {"items": []}

    monkeypatch.setattr(staging_api_smoke, "request_json", fake_request)
    with pytest.raises(staging_api_smoke.StagingProbeErrors) as error:
        staging_api_smoke.smoke("https://zhrulokgngjceqgjkcmw.supabase.co",
                                "public-key", "test@example.invalid", "private-password")
    assert str(error.value) == "learner state: HTTP 503, statistics: HTTP 503"
    assert calls == ["auth sign-in", "learner state", "topics", "statistics", "achievements"]
