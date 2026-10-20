"""A staging OAuth retry may re-open only one email rejected before sending."""

import subprocess
from pathlib import Path

import pytest
from tools import retry_staging_worker_email_canary as retry
from tools import run_staging_worker_canary as dispatch
from tools import staging_worker_canary_secrets as secrets


def environment(monkeypatch):
    project = retry.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", project)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{project}:fixture"
                      "@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")
    monkeypatch.setenv("STAGING_CANARY_REVIEWER_EMAIL", "reviewer@example.test")


def test_retry_refuses_production_before_sql(monkeypatch):
    environment(monkeypatch)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", retry.DEMO_PROJECT_REF)
    monkeypatch.setattr(retry.subprocess, "run", lambda *_a, **_k: pytest.fail("psql called"))
    assert retry.main() == 2


def test_retry_does_not_dispatch_when_sql_guard_fails(monkeypatch, capsys):
    environment(monkeypatch)
    monkeypatch.setattr(retry.subprocess, "run", lambda *_a, **_k:
                        subprocess.CompletedProcess([], 1, "", "private database error"))
    monkeypatch.setattr(retry, "run", lambda *_: pytest.fail("worker called"))
    assert retry.main() == 1
    assert "private database error" not in capsys.readouterr().err


def test_retry_dispatches_only_email_after_guard_passes(monkeypatch):
    environment(monkeypatch)
    statements = []

    def fake_psql(_args, **kwargs):
        statements.append(kwargs["input"])
        return subprocess.CompletedProcess([], 0, "", "")

    called = []
    monkeypatch.setattr(retry.subprocess, "run", fake_psql)
    monkeypatch.setattr(retry, "run", lambda job: called.append(job) or 0)
    assert retry.main() == 0
    assert called == ["editorial_email"]
    assert "failure_code='sender_authorization'" in statements[0]
    assert "sent_at is null" in statements[0]
    assert "edge_worker_email_batch_eligible" in statements[0]


def test_pending_email_fixture_must_match_one_canary(monkeypatch):
    environment(monkeypatch)

    def fake_query(_env, sql):
        if "count(distinct b.id)" in sql:
            return "1"
        if "where status in ('pending','sending')" in sql:
            return "1"
        return "0"

    monkeypatch.setattr(dispatch, "query", fake_query)
    assert dispatch.fixture_is_safe({}, "editorial_email")
    monkeypatch.setattr(dispatch, "query", lambda _env, sql:
                        "0" if "count(distinct b.id)" in sql else fake_query(_env, sql))
    assert not dispatch.fixture_is_safe({}, "editorial_email")


def test_email_retry_installs_no_push_or_gemini_secret(monkeypatch):
    environment(monkeypatch)
    monkeypatch.setenv("STAGING_CANARY_GMAIL_FROM", "sender@example.test")
    monkeypatch.setenv("STAGING_CANARY_GMAIL_CLIENT_ID", "client-id")
    monkeypatch.setenv("STAGING_CANARY_GMAIL_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("STAGING_CANARY_GMAIL_REFRESH_TOKEN", "refresh-token")
    saved = []

    def fake_cli(args, **_kwargs):
        saved.append(Path(args[4]).read_text(encoding="utf-8"))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(secrets.subprocess, "run", fake_cli)
    assert secrets.configure_email() == 0
    assert "WORKER_CANARY_EDITORIAL_EMAIL_DAILY_CAP=2" in saved[0]
    assert "WORKER_CANARY_EDITORIAL_GMAIL_REFRESH_TOKEN=refresh-token" in saved[0]
    assert "WORKER_CANARY_GEMINI_API_KEY=" not in saved[0]
    assert "WORKER_CANARY_WORKER_PUSH_TEST_TOKENS=" not in saved[0]
