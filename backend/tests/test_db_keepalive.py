"""Pool warming must be bounded, release connections, and follow API lifetime."""

import asyncio
from contextlib import suppress
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.db.keepalive import keep_database_warm


async def stop(task):
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


@pytest.mark.parametrize("failure", ["query_error", "query_timeout", "checkout_timeout", "release_timeout"])
async def test_probe_recovers_without_overlap_or_leaking_a_connection(failure, caplog):
    entered = 0
    active = 0
    maximum_active = 0
    recovered = asyncio.Event()

    async def query(sql):
        assert sql == "SELECT 1"
        if entered == 1:
            if failure == "query_error":
                raise ConnectionError("private connection details must not be logged")
            if failure != "release_timeout":
                await asyncio.Event().wait()
        else:
            recovered.set()

    async def connect():
        nonlocal entered, active, maximum_active
        entered += 1
        if entered == 1 and failure == "checkout_timeout":
            await asyncio.Event().wait()
        active += 1
        maximum_active = max(maximum_active, active)
        released = False

        async def invalidate():
            nonlocal active, released
            if released:
                return
            released = True
            active -= 1

        async def close():
            if entered == 1 and failure == "release_timeout":
                await asyncio.Event().wait()
            await invalidate()

        return SimpleNamespace(exec_driver_sql=query, close=close, invalidate=invalidate)

    task = asyncio.create_task(keep_database_warm(SimpleNamespace(connect=connect), 0.02, 0.02))
    try:
        await asyncio.wait_for(recovered.wait(), 2)
    finally:
        await stop(task)
    assert entered == 2
    assert maximum_active == 1
    assert active == 0
    assert "Database warm-up failed" in caplog.text
    assert "private connection details" not in caplog.text


@pytest.mark.parametrize("fail_request", [False, True])
@pytest.mark.parametrize("fail_cleanup", [False, True])
async def test_lifespan_starts_without_waiting_and_cancels_probe_before_disposal(monkeypatch, fail_request, fail_cleanup):
    from app import main

    config = Settings(
        _env_file=None, database_url="postgresql://test:test@localhost/test",
        supabase_url="http://test.invalid", supabase_jwks_url="http://test.invalid/jwks",
        db_keepalive_interval_seconds=30,
    )
    events = []
    probing = asyncio.Event()

    async def query(sql):
        probing.set()
        await asyncio.Event().wait()

    async def close():
        events.append("released")
        if fail_cleanup:
            raise ConnectionError("rollback failed during shutdown")

    connection = SimpleNamespace(
        exec_driver_sql=query,
        close=close,
        invalidate=AsyncMock(),
    )
    engine = SimpleNamespace(
        connect=AsyncMock(return_value=connection),
        dispose=AsyncMock(side_effect=lambda: events.append("disposed")),
    )
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "get_settings", lambda: config)

    async def run():
        async with main.lifespan(main.app):
            await asyncio.wait_for(probing.wait(), 2)
            if fail_request:
                raise RuntimeError("lifespan body failed")

    if fail_request:
        with pytest.raises(RuntimeError, match="lifespan body failed"):
            await run()
    else:
        await run()
    assert events == ["released", "disposed"]
    assert connection.invalidate.await_count == int(fail_cleanup)


async def test_zero_interval_disables_warming(monkeypatch):
    from app import main

    config = Settings(
        _env_file=None, database_url="postgresql://test:test@localhost/test",
        supabase_url="http://test.invalid", supabase_jwks_url="http://test.invalid/jwks",
        db_keepalive_interval_seconds=0,
    )
    probe = AsyncMock()
    engine = SimpleNamespace(dispose=AsyncMock())
    monkeypatch.setattr(main, "get_settings", lambda: config)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "keep_database_warm", probe)
    async with main.lifespan(main.app):
        await asyncio.sleep(0)
    probe.assert_not_called()
    engine.dispose.assert_awaited_once()
