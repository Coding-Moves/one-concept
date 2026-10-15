"""Protected staging smoke guards its target and checks contracts without logging tokens."""

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
