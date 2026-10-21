"""The email receipt check only reconciles a completed staging send."""

from tools import inspect_staging_worker_canary as inspect


def staging_environment(monkeypatch):
    project = inspect.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", project)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{project}:fixture"
                      "@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")


def test_reconciliation_refuses_production_before_sql(monkeypatch):
    staging_environment(monkeypatch)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", inspect.DEMO_PROJECT_REF)
    monkeypatch.setattr(inspect, "read_row", lambda *_: (_ for _ in ()).throw(
        AssertionError("unexpected SQL")))
    assert inspect.main(reconcile_http=True) == 1


def test_reconciliation_polls_only_existing_sent_run(monkeypatch):
    staging_environment(monkeypatch)
    before = ["succeeded", "0", "none", "0", "1", "1", "0", "0", "0"]
    after = before.copy()
    after[1] = "200"
    runs = iter((before, after))
    calls = []

    def fake_read(_env, sql, fields):
        calls.append(sql)
        if sql == inspect.RUN_SQL:
            assert fields == 9
            return next(runs)
        if sql == inspect.BATCH_SQL:
            return ["sent", "3", "none"]
        if "from cron.job" in sql:
            return ["0"]
        if sql == "select public.edge_worker_poll_http()":
            return ["1"]
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(inspect, "read_row", fake_read)
    assert inspect.main(reconcile_http=True) == 0
    assert calls.count("select public.edge_worker_poll_http()") == 1
    assert all("dispatch" not in sql for sql in calls)


def test_reconciliation_never_polls_an_unsent_batch(monkeypatch):
    staging_environment(monkeypatch)
    calls = []

    def fake_read(_env, sql, _fields):
        calls.append(sql)
        if sql == inspect.RUN_SQL:
            return ["succeeded", "0", "none", "0", "1", "0", "0", "1", "0"]
        if sql == inspect.BATCH_SQL:
            return ["failed", "2", "sender_authorization"]
        if "from cron.job" in sql:
            return ["0"]
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(inspect, "read_row", fake_read)
    assert inspect.main(reconcile_http=True) == 2
    assert "select public.edge_worker_poll_http()" not in calls


def test_worker_smoke_reads_only_safe_status_with_closed_gates(monkeypatch, capsys):
    staging_environment(monkeypatch)
    calls = []

    def fake_read(_env, sql, fields):
        calls.append(sql)
        if "from cron.job" in sql:
            assert fields == 1
            return ["0"]
        assert sql == inspect.SMOKE_SQL and fields == 4
        return ["failed", "503", "task_failed", "0"]

    monkeypatch.setattr(inspect, "read_row", fake_read)
    assert inspect.main(worker_smoke=True) == 0
    assert capsys.readouterr().out.strip() == (
        "Staging worker smoke: status=failed http=503 error=task_failed disabled=0")
    assert len(calls) == 2


def test_worker_smoke_refuses_active_gates(monkeypatch):
    staging_environment(monkeypatch)
    calls = []

    def fake_read(_env, sql, _fields):
        calls.append(sql)
        assert "from cron.job" in sql
        return ["1"]

    monkeypatch.setattr(inspect, "read_row", fake_read)
    assert inspect.main(worker_smoke=True) == 2
    assert len(calls) == 1
