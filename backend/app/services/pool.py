"""Keeping each topic stocked with published concepts.

The catalog is global: one generated lesson serves every user, which is the
single biggest cost lever in the design. Topping up ahead of demand is what
keeps Gemini off the request path.
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.generation import GenerationError, generate_concept

log = logging.getLogger(__name__)

# Scalar subqueries, not joins: joining both concepts and backlog to topics
# multiplies the rows and inflates every count by the size of the other table.
_POOL_COUNTS = text("""
    select t.id, t.slug, t.name,
           (select count(*) from public.concepts c
             where c.topic_id = t.id and c.status = 'published')::int as published,
           (select count(*) from public.concept_backlog b
             where b.topic_id = t.id and b.status = 'pending')::int   as pending
      from public.topics t
     where t.is_active
     order by published asc
""")

# Claim one item so two workers cannot generate the same title.
_CLAIM = text("""
    update public.concept_backlog
       set status = 'generating', attempts = attempts + 1
     where id = (
         select b.id from public.concept_backlog b
          where b.status = 'pending'
            and (cast(:topic_id as uuid) is null or b.topic_id = cast(:topic_id as uuid))
            and b.attempts < 3
          order by b.created_at
          for update skip locked
          limit 1
     )
    returning id, slug, title, angle, difficulty, topic_id
""")

_TOPIC_NAME = text("select name from public.topics where id = :tid")

_PUBLISH = text("""
    with inserted as (
        insert into public.concepts
            (topic_id, slug, title, summary, example, difficulty,
             status, source, model, prompt_version)
        values (:topic_id, :slug, :title, :summary, :example, :difficulty,
                'published', 'gemini', :model, :prompt_version)
        on conflict (slug) do nothing
        returning id
    )
    update public.concept_backlog set status = 'done', last_error = null
     where id = :backlog_id
    returning (select id from inserted) as concept_id
""")

_FAIL = text("""
    update public.concept_backlog
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           last_error = :error
     where id = :backlog_id
""")


@dataclass
class TopUpResult:
    generated: int
    failed: int
    skipped_reason: str | None = None


async def generate_one(
    session: AsyncSession, api_key: str, model: str, topic_id: uuid.UUID | None = None
) -> uuid.UUID | None:
    """Generate and publish a single backlog item. Returns the concept id."""
    claimed = (await session.execute(_CLAIM, {"topic_id": topic_id})).first()
    await session.commit()
    if claimed is None:
        return None

    topic_name = (await session.execute(_TOPIC_NAME, {"tid": claimed.topic_id})).scalar_one()

    try:
        result = await generate_concept(
            title=claimed.title,
            topic_name=topic_name,
            angle=claimed.angle,
            api_key=api_key,
            model=model,
        )
    except GenerationError as exc:
        # Leave it pending for another attempt; give up after three so one bad
        # title cannot block the queue forever.
        log.warning("generation failed for %s: %s", claimed.slug, exc)
        await session.execute(_FAIL, {"backlog_id": claimed.id, "error": str(exc)[:500]})
        await session.commit()
        return None

    concept_id = (
        await session.execute(
            _PUBLISH,
            {
                "topic_id": claimed.topic_id,
                "slug": claimed.slug,
                "title": claimed.title,
                "summary": result.summary,
                "example": result.example,
                "difficulty": claimed.difficulty,
                "model": result.model,
                "prompt_version": result.prompt_version,
                "backlog_id": claimed.id,
            },
        )
    ).scalar_one_or_none()
    await session.commit()
    log.info("published %s", claimed.slug)
    return concept_id


async def top_up(
    session: AsyncSession,
    *,
    api_key: str,
    model: str,
    enabled: bool,
    minimum_per_topic: int,
    call_cap: int,
) -> TopUpResult:
    """Bring every topic up to `minimum_per_topic` published concepts."""
    if not enabled:
        return TopUpResult(0, 0, "generation disabled")
    if not api_key:
        return TopUpResult(0, 0, "no API key configured")

    generated = failed = calls = 0
    for topic in (await session.execute(_POOL_COUNTS)).all():
        deficit = minimum_per_topic - topic.published
        if deficit <= 0:
            continue
        wanted = min(deficit, topic.pending)
        for _ in range(wanted):
            if calls >= call_cap:
                # A hard ceiling so a retry loop cannot burn the daily quota.
                log.warning("stopping: hit the daily call cap of %s", call_cap)
                return TopUpResult(generated, failed, "daily call cap reached")
            calls += 1
            if await generate_one(session, api_key, model, topic.id):
                generated += 1
            else:
                failed += 1

    return TopUpResult(generated, failed)
