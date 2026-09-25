"""Run with: python -m app.workers.pool_topup

Scheduled daily by the host. Keeps every topic stocked so the request
path never waits on a model.
"""

import asyncio
import logging

from sqlalchemy import text

from app.config import get_settings
from app.db.session import SessionLocal, engine
from app.services.pool import top_up
from app.services.supply import plan_active_readers


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    settings = get_settings()

    try:
        async with SessionLocal() as session:
            await session.execute(
                text("""insert into public.content_worker_runs(worker,outcome)
              values ('pool_topup','running') on conflict(worker) do update
              set started_at=now(),finished_at=null,outcome='running',generated=0,failed=0""")
            )
            await session.commit()
            try:
                await plan_active_readers(session)
                result = await top_up(
                    session,
                    api_key=settings.gemini_api_key,
                    model=settings.gemini_model,
                    enabled=settings.generation_enabled,
                    minimum_per_topic=settings.min_pool_per_topic,
                    call_cap=settings.generation_daily_call_cap,
                    pace_seconds=settings.generation_pace_seconds,
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
                    "generated": result.generated,
                    "failed": result.failed,
                },
            )
            await session.commit()
    finally:
        await engine.dispose()

    if result.skipped_reason:
        logging.info("nothing to do: %s", result.skipped_reason)
    else:
        logging.info("generated %s, failed %s", result.generated, result.failed)


if __name__ == "__main__":
    asyncio.run(main())
