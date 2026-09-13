"""Run with: python -m app.workers.rewrite_catalog

One-off (but re-runnable) pass that rewrites every published concept with the
current prompt as review drafts. Skips lessons with pending drafts or the current PROMPT_VERSION,
so an interrupted run resumes where it stopped. Titles, slugs, ids, and every
user's history and published words stay untouched until explicit approval.
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
from app.services.generation_budget import (
    GenerationBudgetExhausted,
    GenerationBusy,
    check_generation_capacity,
    reserve_generation_call,
)

log = logging.getLogger(__name__)

PACE_SECONDS = 6.0
BACKOFF_START, BACKOFF_MAX, MAX_RATE_LIMIT_STREAK = 15.0, 120.0, 5

_TODO = text("""
    select c.id, c.title, c.content_version, c.curriculum, t.name as topic_name
      from public.concepts c join public.topics t on t.id = c.topic_id
     where c.status = 'published'
       and t.is_active
       and coalesce(c.prompt_version, '') <> :pv
       and not exists (select 1 from public.concept_revisions r where r.concept_id=c.id
         and r.status in ('draft','generating'))
     order by c.created_at
""")

_CLAIM = text("""
    insert into public.concept_revisions(concept_id,base_version,body,status)
    select id,content_version,'{}'::jsonb,'generating' from public.concepts c
    where id=:id and content_version=:version and status='published'
      and exists(select 1 from public.topics t where t.id=c.topic_id and t.is_active)
      and not exists(select 1 from public.concept_revisions r where r.concept_id=c.id
        and r.status in ('draft','generating')) returning id
""")

_UPDATE = text("""
    update public.concept_revisions r set body=jsonb_build_object('title',c.title,
      'summary',cast(:summary as text),'example',cast(:example as text),
      'curriculum',c.curriculum,'model',cast(:model as text),'prompt_version',cast(:pv as text)),
      status='draft'
    from public.concepts c where r.id=:revision and r.concept_id=c.id
      and r.status='generating' and c.content_version=r.base_version
""")


async def _claim(session, row, cap):
    await session.execute(
        text("select id from public.concepts where id=:id for update"), {"id": row.id}
    )
    revision = await session.scalar(
        _CLAIM, {"id": row.id, "version": row.content_version}
    )
    if revision:
        await reserve_generation_call(session, cap)
        await check_generation_capacity(session)
    await session.commit()
    return revision


async def _release(session, revision):
    await session.execute(
        text(
            "delete from public.concept_revisions where id=:id and status='generating'"
        ),
        {"id": revision},
    )
    await session.commit()


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    settings = get_settings()

    try:
        if not settings.generation_enabled:
            log.info("generation disabled; catalog unchanged")
            return
        if not settings.gemini_api_key:
            log.info("no API key configured; catalog unchanged")
            return
        async with SessionLocal() as session:
            await session.execute(
                text(
                    "delete from public.concept_revisions where status='generating' and created_at<now()-interval '30 minutes'"
                )
            )
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
                        revision = await _claim(
                            session, row, settings.generation_daily_call_cap
                        )
                        if not revision:
                            break
                        result = await generate_concept(
                            title=row.title,
                            topic_name=row.topic_name,
                            angle=None,
                            api_key=settings.gemini_api_key,
                            model=settings.gemini_model,
                        )
                    except GenerationBusy:
                        await session.rollback()
                        log.info("shared generation capacity busy; resume on a later run")
                        return
                    except GenerationBudgetExhausted:
                        await session.rollback()
                        log.info(
                            "daily call cap reached: rewritten %s, failed %s (resume on a later day)",
                            rewritten,
                            failed,
                        )
                        return
                    except RateLimitedError as exc:
                        await _release(session, revision)
                        streak += 1
                        if streak >= MAX_RATE_LIMIT_STREAK:
                            log.warning("giving up: %s consecutive rate limits", streak)
                            log.info(
                                "rewritten %s, failed %s (resume by re-running)",
                                rewritten,
                                failed,
                            )
                            return
                        delay = max(exc.retry_after or 0.0, backoff)
                        log.warning(
                            "rate limited; retrying %s in %.0fs", row.title, delay
                        )
                        await asyncio.sleep(delay)
                        backoff = min(backoff * 2, BACKOFF_MAX)
                        continue
                    except GenerationError as exc:
                        await _release(session, revision)
                        # Leave it on the old prompt version; a later run retries it.
                        log.warning("skipping %s (%s)", row.title, type(exc).__name__)
                        failed += 1
                        break
                    streak, backoff = 0, BACKOFF_START
                    await session.execute(
                        _UPDATE,
                        {
                            "id": row.id,
                            "revision": revision,
                            "summary": result.summary,
                            "example": result.example,
                            "model": result.model,
                            "pv": result.prompt_version,
                        },
                    )
                    await session.commit()
                    rewritten += 1
                    log.info(
                        "staged revision for %s (%s/%s)",
                        row.title,
                        rewritten,
                        len(todo),
                    )
                    break
                await asyncio.sleep(PACE_SECONDS)

        log.info("done: rewritten %s, failed %s", rewritten, failed)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
