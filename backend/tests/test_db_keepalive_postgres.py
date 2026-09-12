"""Reproduce idle expiry with real PostgreSQL, never a configured live database."""

import asyncio
from contextlib import suppress
from time import perf_counter

import pytest
from sqlalchemy import event, text

from app.config import Settings
from app.db.session import create_db_engine


@pytest.mark.parametrize("warming", [False, True])
async def test_idle_request_reconnects_only_when_warming_is_disabled(database, monkeypatch, warming):
    from app import main

    config = Settings(
        _env_file=None, database_url=database,
        supabase_url="http://test.invalid", supabase_jwks_url="http://test.invalid/jwks",
        db_keepalive_interval_seconds=0.2 if warming else 0,
    )
    engine = create_db_engine(config)
    connections = 0

    @event.listens_for(engine.sync_engine, "connect")
    def connected(connection, _):
        nonlocal connections
        connections += 1
        # Expire only this test's physical sessions, outside a transaction.
        connection.run_async(lambda driver: driver.execute("SET idle_session_timeout = '800ms'"))

    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "get_settings", lambda: config)

    async def sample():
        started = perf_counter()
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT 1")) == 1
        return (perf_counter() - started) * 1000

    # Start with two checked-in slots, as after a small concurrent traffic burst.
    # Requests must reuse a warm slot even when the pool has more than one slot.
    async with engine.connect(), engine.connect():
        pass
    try:
        async with main.lifespan(main.app):
            before = connections
            cold_or_reused = []
            for _ in range(3):
                await asyncio.sleep(1.2)
                # Measure outside a probe's checkout, so this is idle latency,
                # not a request competing for a currently borrowed connection.
                async with asyncio.timeout(5):
                    while engine.pool.checkedout():
                        await asyncio.sleep(0.01)
                cold_or_reused.append(round(await sample(), 2))
            assert connections - before == (0 if warming else 3)
            print(f"warming={warming}, new_connections={connections-before}, request_ms={cold_or_reused}")
    finally:
        await engine.dispose()


async def test_warmup_releases_transactions_and_recovers_from_a_dead_connection(database):
    from app.db.keepalive import keep_database_warm

    config = Settings(
        _env_file=None, database_url=database,
        supabase_url="http://test.invalid", supabase_jwks_url="http://test.invalid/jwks",
    )
    engine = create_db_engine(config)
    completed = asyncio.Event()

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def executed(*_):
        completed.set()

    task = asyncio.create_task(keep_database_warm(engine, 0.05, 5))
    try:
        await asyncio.wait_for(completed.wait(), 5)
        # Cancel immediately after SELECT, potentially during rollback/return.
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        assert engine.pool.checkedout() == 0
        async with engine.connect() as connection:
            driver = (await connection.get_raw_connection()).driver_connection
            assert not driver.is_in_transaction()
            await connection.scalar(text("SELECT 1"))
            pid = await connection.scalar(text("SELECT pg_backend_pid()"))

        # A pool slot can still die between probes; pre-ping must remain enabled.
        killer = create_db_engine(config)
        try:
            async with killer.connect() as connection:
                assert await connection.scalar(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
        finally:
            await killer.dispose()
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT 1")) == 1
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await engine.dispose()
