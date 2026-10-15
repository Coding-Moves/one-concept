"""Exercise the one-project demo cleanup against disposable PostgreSQL 16."""

import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

from tools.apply_staging_migrations import FRESH_SQL, RESET_DEMO_SQL


def test_demo_reset_is_atomic_and_leaves_a_fresh_schema():
    if not shutil.which("podman"):
        pytest.skip("podman is required for database integration tests")
    container = f"one-concept-demo-reset-{uuid.uuid4().hex[:8]}"
    started = subprocess.run(
        ["podman", "run", "--rm", "-d", "--name", container,
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "docker.io/library/postgres:16"],
        capture_output=True, text=True,
    )
    if started.returncode != 0:
        pytest.skip(f"could not start disposable PostgreSQL: {started.stderr[:200]}")

    def sql(statement: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["podman", "exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres",
             "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "|", "-c", statement],
            capture_output=True, text=True,
        )

    try:
        for _ in range(60):
            if sql("select 1").returncode == 0:
                break
            time.sleep(0.5)
        else:
            pytest.fail("disposable PostgreSQL did not start")

        setup = """create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
create schema storage;
create table storage.buckets(id text primary key);
create table storage.objects(id text primary key);
create table public.profiles(id uuid primary key references auth.users(id));
create table public.admins(id uuid primary key);
create table public.tasks(user_id uuid references public.profiles(id));
create table public.wallets(user_id uuid references public.profiles(id));
create table public.payout_requests(user_id uuid references public.profiles(id));
create table public.screenshots(user_id uuid references public.profiles(id));
create function public.rls_auto_enable() returns void language plpgsql as $$begin end$$;"""
        assert sql(setup).returncode == 0
        assert sql("with new_user as (insert into auth.users(id) values (gen_random_uuid()) returning id) insert into public.profiles(id) select id from new_user").returncode == 0
        assert sql("insert into storage.objects(id) values ('demo-file')").returncode == 0

        refused = sql(RESET_DEMO_SQL)
        assert refused.returncode != 0
        assert "Storage objects exist" in refused.stderr
        assert sql("select to_regclass('public.profiles') is not null").stdout.strip() == "t"
        assert sql("select exists(select 1 from auth.users)").stdout.strip() == "t"

        assert sql("delete from storage.objects").returncode == 0
        assert sql("insert into storage.buckets(id) values ('demo-bucket')").returncode == 0
        refused_bucket = sql(RESET_DEMO_SQL)
        assert refused_bucket.returncode != 0
        assert "Storage buckets exist" in refused_bucket.stderr
        assert sql("select to_regclass('public.profiles') is not null").stdout.strip() == "t"

        assert sql("delete from storage.buckets").returncode == 0
        cleaned = sql(RESET_DEMO_SQL)
        assert cleaned.returncode == 0, cleaned.stderr[-500:]
        assert sql(FRESH_SQL).stdout.strip() == "t|t|t|t|t|t|t"
        first_migration = Path(__file__).resolve().parents[1] / "migrations" / "0001_schema.sql"
        applied = sql(first_migration.read_text())
        assert applied.returncode == 0, applied.stderr[-500:]
        assert sql("select to_regclass('public.topics') is not null").stdout.strip() == "t"
    finally:
        subprocess.run(["podman", "rm", "-f", container], capture_output=True)
