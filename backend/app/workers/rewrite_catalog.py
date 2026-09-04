"""Run with: python -m app.workers.rewrite_catalog

One-off (but re-runnable) pass that rewrites every published concept with the
current prompt. Skips lessons already written by the current PROMPT_VERSION,
so an interrupted run resumes where it stopped. Titles, slugs, ids, and every
user's history stay untouched — only the words change.
"""

import asyncio
import logging

from sqlalchemy import text

from app.config import get_settings
from app.db.session import SessionLocal, engine
from app.services.generation import (
    PROMPT_VERSION,
    GenerationError,
    RateLimitedError,
    generate_concept,
)

log = logging.getLogger(__name__)

PACE_SECONDS = 6.0
BACKOFF_START, BACKOFF_MAX, MAX_RATE_LIMIT_STREAK = 15.0, 120.0, 5

_TODO = text("""
    select c.id, c.title, t.name as topic_name
      from public.concepts c join public.topics t on t.id = c.topic_id
     where c.status = 'published'
       and coalesce(c.prompt_version, '') <> :pv
     order by c.created_at
""")

_UPDATE = text("""
    update public.concepts
       set summary = :summary, example = :example,
           model = :model, prompt_version = :pv, source = 'gemini'
     where id = :id
""")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = get_settings()

    async with SessionLocal() as session:
        todo = (await session.execute(_TODO, {"pv": PROMPT_VERSION})).all()
        # Close the read transaction before the paced generation loop begins:
        # otherwise this initial SELECT's transaction stays open across every
        # Gemini call, pace sleep, and rate-limit backoff below, pinning a server
        # connection on the transaction pooler for the entire (long) run.
        await session.commit()
        log.info("%s lessons to rewrite with prompt %s", len(todo), PROMPT_VERSION)

        rewritten = failed = 0
        backoff, streak = BACKOFF_START, 0
        for row in todo:
            while True:
                try:
                    result = await generate_concept(
                        title=row.title, topic_name=row.topic_name, angle=None,
                        api_key=settings.gemini_api_key, model=settings.gemini_model,
                    )
                except RateLimitedError as exc:
                    streak += 1
                    if streak >= MAX_RATE_LIMIT_STREAK:
                        log.warning("giving up: %s consecutive rate limits", streak)
                        log.info("rewritten %s, failed %s (resume by re-running)", rewritten, failed)
                        await engine.dispose()
                        return
                    delay = max(exc.retry_after or 0.0, backoff)
                    log.warning("rate limited; retrying %s in %.0fs", row.title, delay)
                    await asyncio.sleep(delay)
                    backoff = min(backoff * 2, BACKOFF_MAX)
                    continue
                except GenerationError as exc:
                    # Leave it on the old prompt version; a later run retries it.
                    log.warning("skipping %s: %s", row.title, exc)
                    failed += 1
                    break
                streak, backoff = 0, BACKOFF_START
                await session.execute(_UPDATE, {
                    "id": row.id, "summary": result.summary, "example": result.example,
                    "model": result.model, "pv": result.prompt_version,
                })
                await session.commit()
                rewritten += 1
                log.info("rewrote %s (%s/%s)", row.title, rewritten, len(todo))
                break
            await asyncio.sleep(PACE_SECONDS)

    log.info("done: rewritten %s, failed %s", rewritten, failed)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
