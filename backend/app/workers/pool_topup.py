"""Run with: python -m app.workers.pool_topup

Scheduled on Railway as a cron job. Keeps every topic stocked so the request
path never waits on a model.
"""

import asyncio
import logging

from app.config import get_settings
from app.db.session import SessionLocal, engine
from app.services.pool import top_up


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = get_settings()

    async with SessionLocal() as session:
        result = await top_up(
            session,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            enabled=settings.generation_enabled,
            minimum_per_topic=settings.min_pool_per_topic,
            call_cap=settings.generation_daily_call_cap,
        )

    if result.skipped_reason:
        logging.info("nothing to do: %s", result.skipped_reason)
    else:
        logging.info("generated %s, failed %s", result.generated, result.failed)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
