"""The protected staging probe must report only fixed labels and SQLSTATEs."""

import subprocess

import pytest

from tools import diagnose_staging_learner as probe


def test_probe_rejects_unquoted_email_and_rolls_back():
    with pytest.raises(ValueError):
        probe.diagnostic_sql("someone@example.invalid'; drop table auth.users; --")
    sql = probe.diagnostic_sql("tester@example.invalid")
    assert sql.strip().endswith("rollback;")
    assert "perform public.edge_api_state" in sql
    assert "set local role service_role;" in sql
    assert "perform public.edge_api_achievements" in sql


def test_probe_redacts_psql_output_and_uses_guarded_connection(monkeypatch, capsys):
    staging = probe.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", staging)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{staging}:secret@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")
    monkeypatch.setenv("SUPABASE_STAGING_TEST_EMAIL", "tester@example.invalid")
    monkeypatch.setattr(probe.shutil, "which", lambda name: "/usr/bin/psql")

    def fake_run(args, *, input, env, text, capture_output, check, timeout):
        assert args == ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q"]
        assert "tester@example.invalid" in input
        assert "STAGING_DIRECT_URL" not in env
        assert env["PGPASSWORD"] == "secret"
        return subprocess.CompletedProcess(args, 0, "private row", "\n".join([
            "NOTICE: diagnostic=user:ok",
            "NOTICE: diagnostic=state:42703",
            "NOTICE: diagnostic=daily:ok",
            "NOTICE: diagnostic=history:ok",
            "NOTICE: diagnostic=saved:ok",
            "NOTICE: diagnostic=stats:ok",
            "NOTICE: diagnostic=achievements:42501",
            "private provider detail",
        ]))

    monkeypatch.setattr(probe.subprocess, "run", fake_run)
    assert probe.main() == 0
    assert capsys.readouterr().out == "state: 42703\ndaily: ok\nhistory: ok\nsaved: ok\nstats: ok\nachievements: 42501\n"


def test_probe_rejects_other_project_before_psql(monkeypatch, capsys):
    monkeypatch.setenv("STAGING_PROJECT_REF", "otherprojectreference")
    monkeypatch.setattr(probe.subprocess, "run", lambda *args, **kwargs: pytest.fail("psql ran"))
    assert probe.main() == 1
    assert "setup failed" in capsys.readouterr().err
