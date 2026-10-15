"""The staging schema tool must reject wrong-project connection strings."""

import json
import subprocess
import sys

import pytest
from sqlalchemy import text

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


def test_inspection_is_read_only_and_does_not_print_credentials(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", PRODUCTION)
    monkeypatch.setenv(
        "STAGING_DIRECT_URL",
        f"postgresql://postgres.{STAGING}:private-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
    )
    (tmp_path / "0001_schema.sql").write_text("select 1;")
    monkeypatch.setattr(runner, "MIGRATIONS", tmp_path)
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/usr/bin/psql")
    monkeypatch.setattr(sys, "argv", ["apply_staging_migrations.py", "--inspect"])
    calls = []

    def fake_psql(_env, *args):
        calls.append(args)
        output = '{"auth_users":true,"profiles":true}' if len(calls) == 1 else "f\n"
        return subprocess.CompletedProcess(args, 0, output, "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    assert runner.main() == 0
    assert len(calls) == 2
    assert calls[0][-1] == runner.INSPECT_SQL
    assert "row_security = off" in calls[1][-1]
    assert all("-f" not in call for call in calls)
    output = capsys.readouterr().out
    assert '"profiles": true' in output
    assert '"profiles_has_rows": false' in output
    assert "private-password" not in output


@pytest.mark.asyncio
async def test_inspection_query_reads_schema_metadata_without_user_records(session):
    raw = (await session.execute(text(runner.INSPECT_SQL))).scalar_one()
    flags = json.loads(raw)
    assert flags["auth_users"] and flags["profiles"] and flags["topics"]
    assert "profiles" in flags["public_relations"]
    assert {column["name"] for column in flags["profiles_columns"]} >= {"id", "timezone"}
    assert "on_auth_user_created" in flags["auth_user_triggers"]
