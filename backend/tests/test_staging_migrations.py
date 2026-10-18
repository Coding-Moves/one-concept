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


def test_schema_cache_reload_requires_reviewed_staging_and_uses_only_notify(monkeypatch):
    calls = []

    def fake_psql(_env, *args):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    assert runner.reload_schema_cache({}) == 2
    assert calls == []
    monkeypatch.setenv("STAGING_PROJECT_REF", runner.DEMO_PROJECT_REF)
    assert runner.reload_schema_cache({}) == 0
    assert calls == [("-q", "-c", "NOTIFY pgrst, 'reload schema'")]


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


@pytest.mark.parametrize("freshness", [
    "t|t|f|t|t|t|t\n",  # Another application's table exists without profiles.
    "t|t|t|t|t|t|f\n",  # Auth users exist before the app trigger is installed.
])
def test_other_application_objects_or_auth_users_stop_before_migrations(monkeypatch, tmp_path, freshness):
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", PRODUCTION)
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres:fixture@db.{STAGING}.supabase.co:5432/postgres")
    (tmp_path / "0001_schema.sql").write_text("select 1;")
    monkeypatch.setattr(runner, "MIGRATIONS", tmp_path)
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/usr/bin/psql")
    monkeypatch.setattr(sys, "argv", ["apply_staging_migrations.py"])
    calls = []

    def fake_psql(_env, *args):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, freshness, "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    assert runner.main() == 2
    assert len(calls) == 1
    assert calls[0][-1] == runner.FRESH_SQL


def test_demo_reset_requires_exact_staging_project(monkeypatch, tmp_path):
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", PRODUCTION)
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres:fixture@db.{STAGING}.supabase.co:5432/postgres")
    (tmp_path / "0001_schema.sql").write_text("select 1;")
    monkeypatch.setattr(runner, "MIGRATIONS", tmp_path)
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/usr/bin/psql")
    monkeypatch.setattr(sys, "argv", ["apply_staging_migrations.py", "--reset-demo"])
    monkeypatch.setattr(runner, "psql", lambda *_: pytest.fail("reset reached SQL for wrong project"))
    assert runner.main() == 2


def test_demo_reset_runs_only_reviewed_transaction(monkeypatch, tmp_path, capsys):
    staging = runner.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", staging)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", PRODUCTION)
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{staging}:private-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")
    (tmp_path / "0001_schema.sql").write_text("select 1;")
    monkeypatch.setattr(runner, "MIGRATIONS", tmp_path)
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/usr/bin/psql")
    monkeypatch.setattr(sys, "argv", ["apply_staging_migrations.py", "--reset-demo"])
    calls = []

    def fake_psql(_env, *args):
        calls.append(args)
        output = "" if len(calls) == 1 else "t|t|t|t|t|t|t\n"
        return subprocess.CompletedProcess(args, 0, output, "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    assert runner.main() == 0
    assert len(calls) == 2
    assert calls[0][-1] == runner.RESET_DEMO_SQL
    assert calls[1][-1] == runner.FRESH_SQL
    assert all("-f" not in call for call in calls)
    assert "private-password" not in capsys.readouterr().out


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


def test_incremental_migration_requires_exact_reviewed_project(monkeypatch, tmp_path):
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    files = [tmp_path / runner.INCREMENTAL_BASELINE, *(
        tmp_path / name for name in runner.INCREMENTAL_PROBES
    )]
    monkeypatch.setattr(runner, "function_presence", lambda *_: pytest.fail("unreviewed target reached SQL"))
    assert runner.apply_incremental({}, files) == 2


def test_incremental_probe_accepts_all_reviewed_signatures_without_accepting_sql(monkeypatch):
    calls = []

    def fake_psql(_env, *args):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, "t\n", "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    signatures = ["public.edge_api_stats(uuid)", *(
        signature for probes in runner.INCREMENTAL_PROBES.values() for signature in probes
    )]
    for signature in signatures:
        assert runner.function_presence({}, (signature,)) == (True,)
    assert "public.edge_api_new_profile_token()" in signatures
    assert "public.edge_api_saved(uuid,timestamp with time zone,uuid,integer)" in signatures
    assert all(call[-1].startswith("select to_regprocedure('public.edge_api_")
               or call[-1].startswith("select coalesce((select prosecdef from pg_proc")
               for call in calls)
    with pytest.raises(ValueError, match="Unreviewed"):
        runner.function_presence({}, ("public.edge_api_new_profile_token();drop table users",))
    assert len(calls) == len(signatures)


def _incremental_files(tmp_path):
    baseline = tmp_path / runner.INCREMENTAL_BASELINE
    pending = [tmp_path / name for name in runner.INCREMENTAL_PROBES]
    for file in pending:
        file.write_text("begin; select 1; commit;")
    return [baseline, *pending]


def test_incremental_migration_rejects_unprobed_file_or_missing_baseline(monkeypatch, tmp_path):
    monkeypatch.setenv("STAGING_PROJECT_REF", runner.DEMO_PROJECT_REF)
    files = _incremental_files(tmp_path)
    unknown = tmp_path / "9999_unreviewed.sql"
    monkeypatch.setattr(runner, "function_presence", lambda *_: pytest.fail("unreviewed migration reached SQL"))
    assert runner.apply_incremental({}, files[1:]) == 2
    assert runner.apply_incremental({}, [*files, unknown]) == 2


@pytest.mark.parametrize("mode", ["missing-baseline", "partial", "all-new", "all-present", "last-new"])
def test_incremental_migration_probes_before_and_after_sql(monkeypatch, tmp_path, mode):
    monkeypatch.setenv("STAGING_PROJECT_REF", runner.DEMO_PROJECT_REF)
    files = _incremental_files(tmp_path)
    signatures = list(runner.INCREMENTAL_PROBES.values())
    states = [(mode != "missing-baseline",)]
    if mode == "partial":
        states.append((True, False))
    elif mode in ("all-new", "last-new"):
        for index, probes in enumerate(signatures):
            present = mode == "last-new" and index < len(signatures) - 1
            states.append((True,) * len(probes) if present else (False,) * len(probes))
            if not present:
                states.append((True,) * len(probes))
    elif mode == "all-present":
        states.extend((True,) * len(probes) for probes in signatures)
    probes = iter(states)
    monkeypatch.setattr(runner, "function_presence", lambda *_: next(probes))
    applied = []

    def fake_psql(_env, *args):
        applied.append(args)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(runner, "psql", fake_psql)
    expected = 2 if mode in ("missing-baseline", "partial") else 0
    assert runner.apply_incremental({}, files) == expected
    expected_files = files[1:] if mode == "all-new" else files[-1:] if mode == "last-new" else []
    expected_calls = [str(file) for file in expected_files]
    if expected == 0:
        expected_calls.append("NOTIFY pgrst, 'reload schema'")
    assert [call[-1] for call in applied] == expected_calls


def test_incremental_migration_rejects_unreadable_postcheck(monkeypatch, tmp_path):
    monkeypatch.setenv("STAGING_PROJECT_REF", runner.DEMO_PROJECT_REF)
    files = _incremental_files(tmp_path)
    probes = iter([(True,), (False, False), None])
    monkeypatch.setattr(runner, "function_presence", lambda *_: next(probes))
    monkeypatch.setattr(runner, "psql", lambda _env, *args: subprocess.CompletedProcess(args, 0, "", ""))
    assert runner.apply_incremental({}, files) == 1


@pytest.mark.asyncio
async def test_inspection_query_reads_schema_metadata_without_user_records(session):
    raw = (await session.execute(text(runner.INSPECT_SQL))).scalar_one()
    flags = json.loads(raw)
    assert flags["auth_users"] and flags["profiles"] and flags["topics"]
    assert "profiles" in flags["public_relations"]
    assert {column["name"] for column in flags["profiles_columns"]} >= {"id", "timezone"}
    assert "on_auth_user_created" in flags["auth_user_triggers"]


@pytest.mark.asyncio
async def test_incremental_signatures_resolve_after_ordered_migrations(session):
    signatures = ("public.edge_api_stats(uuid)", *(
        signature for probes in runner.INCREMENTAL_PROBES.values() for signature in probes
    ))
    for signature in signatures:
        if signature.startswith("definer:"):
            assert (await session.execute(text("""select prosecdef from pg_proc
                where oid = to_regprocedure(:signature)"""),
                {"signature": signature[8:]})).scalar_one()
        else:
            assert (await session.execute(text("select to_regprocedure(:signature) is not null"),
                {"signature": signature})).scalar_one()
