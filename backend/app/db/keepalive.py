"""Keep a reusable API connection warm without adding work to user requests."""

import asyncio
import logging
from time import perf_counter

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

logger = logging.getLogger("uvicorn.error")


async def _release(connection: AsyncConnection, timeout: float) -> None:
    try:
        async with asyncio.timeout(timeout):
            await connection.close()
    except BaseException:
        # A failed rollback must not leave a borrowed or broken pool slot.
        await connection.invalidate()
        raise


async def _probe(engine: AsyncEngine, timeout: float) -> None:
    connection = None
    try:
        async with asyncio.timeout(timeout):
            connection = await engine.connect()
            await connection.exec_driver_sql("SELECT 1")
    finally:
        if connection is not None:
            # SQLAlchemy's context exit shields close(), but cancellation can
            # return before that close finishes. Retain and await cleanup so
            # lifespan disposal cannot race a connection still being returned.
            cleanup = asyncio.create_task(_release(connection, timeout))
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                await cleanup
                raise


async def keep_database_warm(engine: AsyncEngine, interval: float, timeout: float) -> None:
    """Probe immediately, then periodically; cancellation belongs to the lifespan."""
    while True:
        started = perf_counter()
        try:
            await _probe(engine, timeout)
            logger.debug("Database warm-up completed in %.1f ms", (perf_counter() - started) * 1000)
        except Exception as error:
            # Cleanup errors must not turn a shutdown cancellation into a retry.
            if asyncio.current_task().cancelling():
                raise asyncio.CancelledError from error
            # Outages must not stop the API or cause tight retry loops. Log only
            # the exception type: driver messages can contain connection details.
            logger.warning("Database warm-up failed (%s); retrying later", type(error).__name__)
        await asyncio.sleep(interval)
