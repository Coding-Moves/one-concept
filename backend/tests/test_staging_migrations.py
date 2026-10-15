"""The staging schema tool must reject wrong-project connection strings."""

import subprocess
import sys

import pytest

from tools import apply_staging_migrations as runner
from tools.apply_staging_migrations import connection_environment


STAGING = "s" * 20
PRODUCTION = "p" * 20


def test_direct_and_session_pooler_identify_staging_only(monkeypatch):
    monkeypatch.setenv("STAGING_DIRECT_URL", "must-not-inherit")
    direct = f"postgresql://postgres:staging-password@db.{STAGING}.supabase.co:5432/postgres"
    env = connection_environment(STAGING, PRODUCTION, direct)
    assert env["PGHOST"] == f"db.{STAGING}.supabase.co"
    assert env["PGPASSWORD"] == "staging-password"
    assert "STAGING_DIRECT_URL" not in env
    pooled = f"postgresql://postgres.{STAGING}:staging-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
    assert connection_environment(STAGING, PRODUCTION, pooled)["PGUSER"] == f"postgres.{STAGING}"


@pytest.mark.parametrize("url", [
    f"postgresql://postgres:secret@db.{PRODUCTION}.supabase.co:5432/postgres",
    f"postgresql://postgres.{PRODUCTION}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    f"postgresql://postgres:secret@db.{STAGING}.supabase.co:6543/postgres",
    f"postgresql://postgres:secret@db.{STAGING}.supabase.co:5432/other",
])
def test_wrong_project_or_connection_mode_is_rejected(url):
    with pytest.raises(ValueError):
        connection_environment(STAGING, PRODUCTION, url)


def test_same_project_ref_is_rejected():
    url = f"postgresql://postgres:secret@db.{STAGING}.supabase.co:5432/postgres"
    with pytest.raises(ValueError):
        connection_environment(STAGING, STAGING, url)


def test_existing_application_schema_stops_before_any_migration(monkeypatch, tmp_path):
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", PRODUCTION)
    monkeypatch.setenv(
        "STAGING_DIRECT_URL",
        f"postgresql://postgres:fixture@db.{STAGING}.supabase.co:5432/postgres",
    )
    (tmp_path / "0001_schema.sql").write_text("select 1;")
    monkeypatch.setattr(runner, "MIGRATIONS", tmp_path)
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/usr/bin/psql")
    monkeypatch.setattr(sys, "argv", ["apply_staging_migrations.py"])
    calls = []

    def fake_psql(_env, *args):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, "t|f\n", "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    assert runner.main() == 2
    assert len(calls) == 1
    assert "-f" not in calls[0]
