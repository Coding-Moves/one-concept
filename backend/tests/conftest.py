"""Integration test harness.

Selection is mostly SQL — unique constraints, a CTE, and a race — so testing it
against SQLite or a mock would prove nothing. These tests run against a real
PostgreSQL started with podman, using the project's own migration files.
"""

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Environment variables beat the .env file in pydantic-settings, so this
# insulates the suite from whatever the developer has configured locally.
# With a real key and GENERATION_ENABLED=true in .env, selection would call
# the actual Gemini API instead of reporting exhaustion.
os.environ["GENERATION_ENABLED"] = "false"
os.environ["GEMINI_API_KEY"] = ""
os.environ["GENERATION_DAILY_CALL_CAP"] = "200"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@127.0.0.1:1/test"
os.environ["SUPABASE_URL"] = "https://test.invalid"
os.environ["SUPABASE_JWKS_URL"] = "https://test.invalid/jwks"
os.environ["ENVIRONMENT"] = "test"

CONTAINER_ENGINE = os.environ.get("TEST_CONTAINER_ENGINE", "podman")
CONTAINER = f"one-concept-test-{uuid.uuid4().hex[:12]}"
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

# Supabase provides these; the migrations depend on them, so a bare Postgres
# needs stand-ins before the schema will apply.
AUTH_STUB = (Path(__file__).parent / 'auth_stub.sql').read_text()


def _psql(sql: str = None, file: Path = None) -> subprocess.CompletedProcess:
    data = sql if sql is not None else file.read_text()
    return subprocess.run(
        [CONTAINER_ENGINE, "exec", "-i", CONTAINER, "psql", "-U", "postgres",
         "-v", "ON_ERROR_STOP=1", "-q"],
        input=data, text=True, capture_output=True,
    )


@pytest.fixture(scope="session")
def database():
    def unavailable(reason):
        if os.environ.get("TEST_REQUIRE_DATABASE") == "1":
            pytest.fail(reason)
        pytest.skip(reason)

    if not shutil.which(CONTAINER_ENGINE):
        unavailable(f"{CONTAINER_ENGINE} is required for integration tests")

    started = subprocess.run(
        [CONTAINER_ENGINE, "run", "--rm", "-d", "--name", CONTAINER,
         "-e", "POSTGRES_PASSWORD=postgres", "-p", "127.0.0.1::5432",
         "docker.io/library/postgres:16"],
        capture_output=True, text=True,
    )
    if started.returncode != 0:
        unavailable(f"could not start postgres: {started.stderr[:200]}")

    try:
        for _ in range(60):
            ready = subprocess.run(
                [CONTAINER_ENGINE, "exec", CONTAINER, "pg_isready", "-U", "postgres"],
                capture_output=True,
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            unavailable("postgres did not become ready")

        port = subprocess.check_output(
            [CONTAINER_ENGINE, "port", CONTAINER, "5432/tcp"], text=True,
        ).strip().rsplit(":", 1)[1]
        assert _psql(sql=AUTH_STUB).returncode == 0, "auth stub failed"
        for migration in sorted(MIGRATIONS.glob("0*.sql")):
            result = _psql(file=migration)
            assert result.returncode == 0, f"{migration.name} failed: {result.stderr[:400]}"

        yield f"postgresql+asyncpg://postgres:postgres@127.0.0.1:{port}/postgres"
    finally:
        subprocess.run([CONTAINER_ENGINE, "rm", "-f", CONTAINER], capture_output=True)


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


@pytest_asyncio.fixture
async def empty_generation_budget(session):
    """Generation tests share a schema, but each starts with its own daily budget."""
    from sqlalchemy import text

    await session.execute(text("delete from public.generation_daily_usage"))
    await session.commit()
    yield
    await session.rollback()
    await session.execute(text("delete from public.generation_daily_usage"))
    await session.commit()


@pytest.fixture(autouse=True)
def no_live_http(monkeypatch):
    """All HTTP integration uses ASGI/MockTransport; never contact a real provider."""
    import httpx

    async def reject_async(self, request):
        raise AssertionError('Live HTTP transport is disabled in tests; use a mock transport')

    def reject_sync(self, request):
        raise AssertionError('Live HTTP transport is disabled in tests; use a mock transport')

    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', reject_async)
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', reject_sync)
