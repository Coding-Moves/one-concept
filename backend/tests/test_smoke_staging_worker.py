"""The staging smoke temporarily opens only one disabled provider job."""

from tools import smoke_staging_worker as smoke


def staging_environment(monkeypatch):
    project = smoke.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", project)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{project}:fixture"
                      "@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")


def test_refuses_unreviewed_target_before_sql(monkeypatch):
    staging_environment(monkeypatch)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", smoke.DEMO_PROJECT_REF)
    monkeypatch.setattr(smoke, "query", lambda *_: AssertionError("SQL reached"))
    assert smoke.main() == 2


def test_signed_disabled_provider_dispatch_closes_temporary_gate(monkeypatch):
    staging_environment(monkeypatch)
    calls = []

    def fake_query(_env, sql):
        calls.append(sql)
        if "from cron.job" in sql:
            return "0"
        if sql.startswith("select enabled"):
            return "f"
        if "set enabled=true" in sql or "set enabled=false" in sql:
            return smoke.JOB
        if "edge_worker_dispatch" in sql:
            return "123"
        if "edge_worker_poll_http" in sql:
            return "1"
        if "where request_id=123" in sql:
            return "succeeded|200|1"
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(smoke, "query", fake_query)
    assert smoke.main() == 0
    assert "set enabled=false" in calls[-1]


def test_failed_dispatch_still_closes_temporary_gate(monkeypatch):
    staging_environment(monkeypatch)
    calls = []

    def fake_query(_env, sql):
        calls.append(sql)
        if "from cron.job" in sql:
            return "0"
        if sql.startswith("select enabled"):
            return "f"
        if "set enabled=true" in sql or "set enabled=false" in sql:
            return smoke.JOB
        if "edge_worker_dispatch" in sql:
            return None
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(smoke, "query", fake_query)
    assert smoke.main() == 1
    assert "set enabled=false" in calls[-1]


def test_failed_worker_logs_only_safe_classification(monkeypatch, capsys):
    staging_environment(monkeypatch)
    calls = []

    def fake_query(_env, sql):
        calls.append(sql)
        if "from cron.job" in sql:
            return "0"
        if sql.startswith("select enabled"):
            return "f"
        if "set enabled=true" in sql or "set enabled=false" in sql:
            return smoke.JOB
        if "edge_worker_dispatch" in sql:
            return "123"
        if "edge_worker_poll_http" in sql:
            return "1"
        if "where r.request_id=123" in sql:
            return "failed|503|started|http_503|task_failed"
        if "where request_id=123" in sql:
            return "failed|503|"
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(smoke, "query", fake_query)
    assert smoke.main() == 1
    assert "set enabled=false" in calls[-2]
    assert capsys.readouterr().err.strip() == (
        "Signed staging worker dispatch did not complete: "
        "failed|503|started|http_503|task_failed")


def test_failure_classification_discards_unexpected_response(monkeypatch):
    monkeypatch.setattr(smoke, "query", lambda *_: "response with private data")
    assert smoke.failure_label({}, "123") == "unavailable"
