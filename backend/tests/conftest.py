"""Integration test harness.

Selection is mostly SQL — unique constraints, a CTE, and a race — so testing it
against SQLite or a mock would prove nothing. These tests run against a real
PostgreSQL started with podman, using the project's own migration files.
"""

import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

CONTAINER = "one-concept-test-db"
PORT = 55433
DSN = f"postgresql+asyncpg://postgres:postgres@127.0.0.1:{PORT}/postgres"
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

# Supabase provides these; the migrations depend on them, so a bare Postgres
# needs stand-ins before the schema will apply.
AUTH_STUB = """
create role authenticated;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
"""


def _psql(sql: str = None, file: Path = None) -> subprocess.CompletedProcess:
    data = sql if sql is not None else file.read_text()
    return subprocess.run(
        ["podman", "exec", "-i", CONTAINER, "psql", "-U", "postgres",
         "-v", "ON_ERROR_STOP=1", "-q"],
        input=data, text=True, capture_output=True,
    )


@pytest.fixture(scope="session")
def database():
    if not shutil.which("podman"):
        pytest.skip("podman is required for integration tests")

    subprocess.run(["podman", "rm", "-f", CONTAINER], capture_output=True)
    started = subprocess.run(
        ["podman", "run", "--rm", "-d", "--name", CONTAINER,
         "-e", "POSTGRES_PASSWORD=postgres", "-p", f"{PORT}:5432",
         "docker.io/library/postgres:16"],
        capture_output=True, text=True,
    )
    if started.returncode != 0:
        pytest.skip(f"could not start postgres: {started.stderr[:200]}")

    for _ in range(60):
        ready = subprocess.run(
            ["podman", "exec", CONTAINER, "pg_isready", "-U", "postgres"],
            capture_output=True,
        )
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        subprocess.run(["podman", "rm", "-f", CONTAINER], capture_output=True)
        pytest.skip("postgres did not become ready")

    assert _psql(sql=AUTH_STUB).returncode == 0, "auth stub failed"
    for migration in sorted(MIGRATIONS.glob("0*.sql")):
        result = _psql(file=migration)
        assert result.returncode == 0, f"{migration.name} failed: {result.stderr[:400]}"

    yield DSN
    subprocess.run(["podman", "rm", "-f", CONTAINER], capture_output=True)


@pytest_asyncio.fixture
async def sessionmaker_for_test(database):
    engine = create_async_engine(database, echo=False)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def session(sessionmaker_for_test):
    async with sessionmaker_for_test() as s:
        yield s


@pytest_asyncio.fixture
async def user(session):
    """A fresh user, bootstrapped by the same trigger production relies on."""
    from sqlalchemy import text

    user_id = uuid.uuid4()
    await session.execute(
        text("insert into auth.users (id, email) values (:id, :email)"),
        {"id": user_id, "email": f"{user_id}@example.invalid"},
    )
    await session.commit()
    return user_id
