"""Keeping each topic stocked with published concepts.

The catalog is global: one generated lesson serves every user, which is the
single biggest cost lever in the design. Topping up ahead of demand is what
keeps Gemini off the request path.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.generation import GenerationError, RateLimitedError, generate_concept

log = logging.getLogger(__name__)

# The free tier allows roughly ten requests a minute; pacing at this rate keeps
# a full run inside the quota instead of tripping 429s and burning attempts.
BACKOFF_START_SECONDS = 15.0
BACKOFF_MAX_SECONDS = 120.0
MAX_CONSECUTIVE_RATE_LIMITS = 5

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

# Claim one item so two workers cannot generate the same title. The topic name
# is joined into RETURNING here so the caller can commit immediately and hold no
# open transaction across the (multi-second) Gemini round trip — a separate
# topic-name SELECT afterwards would keep a connection pinned on the transaction
# pooler for the whole generation.
# How long a row may sit 'generating' before a later run assumes the worker that
# claimed it died and reclaims it. Comfortably longer than any real generation
# (a few seconds plus rate-limit backoff), short enough that a stranded title
# rejoins the pool within a day's worth of runs.
STALE_CLAIM_MINUTES = 30

# Reclaim rows abandoned mid-generation by a crashed/killed worker: back to
# 'pending' so _CLAIM can pick them up again. The attempt already spent stands,
# so a title that repeatedly strands the worker is still eventually retired
# rather than looping forever.
_REAP_STALE = text("""
    update public.concept_backlog
       set status = 'pending', claimed_at = null
     where status = 'generating'
       and claimed_at is not null
       and claimed_at < now() - make_interval(mins => :max_minutes)
    returning id
""")

_CLAIM = text("""
    update public.concept_backlog b
       set status = 'generating', attempts = b.attempts + 1, claimed_at = now()
      from public.topics t
     where b.id = (
         select b2.id from public.concept_backlog b2
          where b2.status = 'pending'
            and (cast(:topic_id as uuid) is null or b2.topic_id = cast(:topic_id as uuid))
            and b2.attempts < 3
          order by b2.created_at
          for update skip locked
          limit 1
     )
       and t.id = b.topic_id
    returning b.id, b.slug, b.title, b.angle, b.difficulty, b.topic_id,
              t.name as topic_name
""")

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
    update public.concept_backlog
       -- Mark done ONLY when a concept was actually inserted. A slug collision
       -- makes the insert a no-op; marking the row done anyway would retire the
       -- title having burned a Gemini call without ever publishing (issue #37).
       set status = case when exists (select 1 from inserted) then 'done' else 'failed' end,
           last_error = case when exists (select 1 from inserted) then null
                             else 'slug already exists; nothing published' end,
           claimed_at = null
     where id = :backlog_id
    returning (select id from inserted) as concept_id
""")

_FAIL = text("""
    update public.concept_backlog
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           last_error = :error, claimed_at = null
     where id = :backlog_id
""")

# A rate limit is our problem, not the title's: return it to the queue and
# refund the attempt so throttling can never retire an item.
_RELEASE = text("""
    update public.concept_backlog
       set status = 'pending', attempts = greatest(attempts - 1, 0), claimed_at = null
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

    # After the commit above no transaction is open, so nothing is pinned on the
    # pooler while Gemini works — the topic name rode along on the claim.
    try:
        result = await generate_concept(
            title=claimed.title,
            topic_name=claimed.topic_name,
            angle=claimed.angle,
            api_key=api_key,
            model=model,
        )
    except RateLimitedError:
        await session.execute(_RELEASE, {"backlog_id": claimed.id})
        await session.commit()
        raise
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
    if concept_id is not None:
        log.info("published %s", claimed.slug)
    else:
        # The insert was a no-op (slug already exists); _PUBLISH marked the row
        # failed rather than done, so the title is flagged, not silently retired.
        log.warning("not published (slug %s already exists)", claimed.slug)
    return concept_id


async def top_up(
    session: AsyncSession,
    *,
    api_key: str,
    model: str,
    enabled: bool,
    minimum_per_topic: int,
    call_cap: int,
    pace_seconds: float = 0.0,
) -> TopUpResult:
    """Bring every topic up to `minimum_per_topic` published concepts."""
    if not enabled:
        return TopUpResult(0, 0, "generation disabled")
    if not api_key:
        return TopUpResult(0, 0, "no API key configured")

    # Start every run by reclaiming rows a previous worker abandoned mid-flight,
    # so a crash cannot permanently lose a title from the pool (issue #37).
    reaped = (await session.execute(_REAP_STALE, {"max_minutes": STALE_CLAIM_MINUTES})).all()
    await session.commit()
    if reaped:
        log.warning("reclaimed %s stale 'generating' backlog rows", len(reaped))

    generated = failed = calls = 0
    backoff = BACKOFF_START_SECONDS
    rate_limit_streak = 0
    for topic in (await session.execute(_POOL_COUNTS)).all():
        deficit = minimum_per_topic - topic.published
        if deficit <= 0:
            continue
        remaining = min(deficit, topic.pending)
        while remaining > 0:
            if calls >= call_cap:
                # A hard ceiling so a retry loop cannot burn the daily quota.
                log.warning("stopping: hit the daily call cap of %s", call_cap)
                return TopUpResult(generated, failed, "daily call cap reached")
            calls += 1
            try:
                concept_id = await generate_one(session, api_key, model, topic.id)
            except RateLimitedError as exc:
                rate_limit_streak += 1
                if rate_limit_streak >= MAX_CONSECUTIVE_RATE_LIMITS:
                    log.warning("stopping: %s consecutive rate limits", rate_limit_streak)
                    return TopUpResult(generated, failed, "rate limited")
                delay = max(exc.retry_after or 0.0, backoff)
                log.warning("rate limited; retrying %s in %.0fs", topic.slug, delay)
                await asyncio.sleep(delay)
                backoff = min(backoff * 2, BACKOFF_MAX_SECONDS)
                continue
            rate_limit_streak = 0
            backoff = BACKOFF_START_SECONDS
            if concept_id:
                generated += 1
            else:
                failed += 1
            remaining -= 1
            if pace_seconds:
                await asyncio.sleep(pace_seconds)

    return TopUpResult(generated, failed)
