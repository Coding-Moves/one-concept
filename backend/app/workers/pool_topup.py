"""Run with: python -m app.workers.pool_topup

Scheduled on Railway as a cron job. Keeps every topic stocked so the request
path never waits on a model.
"""

import asyncio
import logging

from sqlalchemy import text

from app.services.owner_telemetry import worker_observation
from app.config import get_settings
from app.db.session import SessionLocal, engine
from app.services.pool import top_up
from app.services.editorial_generation import run_batch
from app.services.legacy_enrichment_worker import run_batch as run_legacy_batch
from app.services.supply import plan_active_readers


async def run() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    settings = get_settings()

    async with SessionLocal() as session:
        await session.execute(
            text("""insert into public.content_worker_runs(worker,outcome)
          values ('pool_topup','running') on conflict(worker) do update
          set started_at=now(),finished_at=null,outcome='running',generated=0,failed=0""")
        )
        await session.commit()
        try:
            revisions = await run_batch(session, settings)
            logging.info("revision jobs: %s", revisions)
            legacy = await run_legacy_batch(session, settings)
            logging.info("legacy enrichment: %s", legacy)
            await plan_active_readers(session)
            result = await top_up(
                session,
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                enabled=settings.generation_enabled and settings.future_refill_enabled,
                minimum_per_topic=settings.min_pool_per_topic,
                call_cap=settings.generation_daily_call_cap,
                pace_seconds=settings.generation_pace_seconds,
                future_refill=True,
            )
        except BaseException:
            await session.rollback()
            await session.execute(
                text(
                    "update public.content_worker_runs set outcome='failed',finished_at=now() where worker='pool_topup'"
                )
            )
            await session.commit()
            raise
        await session.execute(
            text("""update public.content_worker_runs set outcome=:outcome,
          finished_at=now(),generated=:generated,failed=:failed where worker='pool_topup'"""),
            {
                "outcome": result.skipped_reason or "completed",
                "generated": result.generated
                + revisions.get("ready_for_review", 0)
                + legacy.get("ready_for_review", 0),
                "failed": result.failed
                + revisions.get("failed", 0)
                + revisions.get("pending", 0)
                + legacy.get("failed", 0)
                + legacy.get("blocked", 0),
            },
        )
        await session.commit()

    if result.skipped_reason:
        logging.info("nothing to do: %s", result.skipped_reason)
    else:
        logging.info("generated %s, failed %s", result.generated, result.failed)


async def main() -> None:
    try:
        async with worker_observation("pool_topup"):
            await run()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
