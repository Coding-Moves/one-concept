"""A provider canary cannot escape staging or leave its job enabled."""

from tools import run_staging_worker_canary as canary


def staging_environment(monkeypatch):
    project = canary.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", project)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{project}:fixture"
                      "@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")


def test_refuses_unreviewed_target_before_sql(monkeypatch):
    staging_environment(monkeypatch)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", canary.DEMO_PROJECT_REF)
    monkeypatch.setattr(canary, "query", lambda *_: (_ for _ in ()).throw(
        AssertionError("unexpected SQL")))
    assert canary.run("editorial_generation") == 2


def test_refuses_unsafe_fixture_before_opening_gate(monkeypatch):
    staging_environment(monkeypatch)
    calls = []

    def fake_query(_env, sql):
        calls.append(sql)
        return "0"

    monkeypatch.setattr(canary, "query", fake_query)
    monkeypatch.setattr(canary, "fixture_is_safe", lambda *_: False)
    assert canary.run("daily_reminders") == 2
    assert all("set enabled=true" not in sql for sql in calls)


def test_provider_success_closes_temporary_gate(monkeypatch):
    staging_environment(monkeypatch)
    monkeypatch.setattr(canary, "fixture_is_safe", lambda *_: True)
    calls = []

    def fake_query(_env, sql):
        calls.append(sql)
        if "from cron.job" in sql or "where enabled" in sql:
            return "0"
        if "set enabled=true" in sql or "set enabled=false" in sql:
            return "editorial_generation"
        if "edge_worker_dispatch" in sql:
            return "123"
        if "edge_worker_poll_http" in sql:
            return "1"
        if "where request_id=123" in sql:
            return "succeeded|200|1"
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(canary, "query", fake_query)
    assert canary.run("editorial_generation") == 0
    assert "set enabled=false" in calls[-1]


def test_provider_failure_closes_temporary_gate(monkeypatch):
    staging_environment(monkeypatch)
    monkeypatch.setattr(canary, "fixture_is_safe", lambda *_: True)
    calls = []

    def fake_query(_env, sql):
        calls.append(sql)
        if "from cron.job" in sql or "where enabled" in sql:
            return "0"
        if "set enabled=true" in sql or "set enabled=false" in sql:
            return "editorial_email"
        if "edge_worker_dispatch" in sql:
            return None
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(canary, "query", fake_query)
    assert canary.run("editorial_email") == 1
    assert "set enabled=false" in calls[-1]
