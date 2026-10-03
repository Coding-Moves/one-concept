"""Optional bounded observations, never a source of raw exception/request data."""

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from sqlalchemy import text

from app.config import get_settings
from app.db.session import SessionLocal

log = logging.getLogger(__name__)
SERVICES = {"api", "reminders", "pool_topup"}
CODES = {"started", "completed", "failed", "database_unavailable", "unexpected_failure"}


async def record(
    service: str, code: str, correlation: UUID, *, factory=None, enabled=None
):
    if enabled is None:
        enabled = get_settings().owner_telemetry_enabled
    if not enabled:
        return
    if (
        service not in SERVICES
        or code not in CODES
        or not isinstance(correlation, UUID)
    ):
        raise ValueError("Unsupported operational observation")

    async def write():
        async with (factory or SessionLocal)() as db:
            await db.execute(text("set local statement_timeout='750ms'"))
            # Serialize pruning/insertion so concurrent events respect the hard cap.
            await db.execute(text("select pg_advisory_xact_lock(297,1)"))
            await db.execute(
                text("""delete from owner_operation_events where observed_at<now()-interval '30 days'
              or id in (select id from owner_operation_events order by observed_at desc,id desc offset 9999)""")
            )
            await db.execute(
                text("""insert into owner_operation_events(service,code,severity,correlation_id)
              values(:service,:code,:severity,:correlation)"""),
                {
                    "service": service,
                    "code": code,
                    "severity": "error"
                    if code in {"failed", "database_unavailable", "unexpected_failure"}
                    else "info",
                    "correlation": correlation,
                },
            )
            await db.commit()

    try:
        await asyncio.wait_for(write(), timeout=1)
    except Exception:
        # DB outage, missing migration, or cap contention must not break jobs or
        # expose secrets. Missing observations are reported as unavailable/stale.
        log.warning("Operational observation unavailable")


@asynccontextmanager
async def worker_observation(service, *, factory=None, enabled=None):
    correlation = uuid4()
    await record(service, "started", correlation, factory=factory, enabled=enabled)
    try:
        yield
    except BaseException:
        await record(service, "failed", correlation, factory=factory, enabled=enabled)
        raise
    else:
        await record(
            service, "completed", correlation, factory=factory, enabled=enabled
        )
