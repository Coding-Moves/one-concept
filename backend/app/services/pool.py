"""Keeping each topic stocked with private drafts awaiting human review.

The catalog is global: one generated lesson serves every user, which is the
single biggest cost lever in the design. Topping up ahead of demand is what
keeps Gemini off the request path.
"""

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.generation import GenerationError, RateLimitedError, generate_concept
from app.services.future_refill_budget import (
    FutureRefillBudgetExhausted,
    reserve_future_refill_call,
)
from app.services.generation_budget import (
    GenerationBudgetExhausted,
    GenerationBusy,
    check_generation_capacity,
    reserve_generation_call,
)
from app.services.supply import target_for
from app.services.review_capacity import review_load, slots_available
from app.services.curriculum import catalog_lock

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
             join public.subtopics s on s.id=c.subtopic_id and s.is_active
             where c.topic_id = t.id and c.status in ('published','draft'))::int as published,
           (select count(*) from public.concept_backlog b
             join public.subtopics s on s.id=b.subtopic_id and s.is_active
             where b.topic_id = t.id and b.status = 'pending'
               and b.attempts<3+(select count(*) from content_retry_log l where l.backlog_id=b.id))::int   as pending
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
#
# A NULL claimed_at on a 'generating' row is also stale: the new _CLAIM always
# stamps claimed_at in the same statement it sets 'generating', so the only way
# a generating row has no timestamp is that it was stranded before migration
# 0008 added the column. Those are exactly the rows #37 is about, so reap them
# too rather than leaving them stuck forever.
_REAP_STALE = text("""
    update public.concept_backlog
       set status = case when attempts >= 3 + (select count(*) from public.content_retry_log r where r.backlog_id=concept_backlog.id) then 'failed' else 'pending' end, claimed_at = null, claim_token = null
     where status = 'generating'
       and (claimed_at is null
            or claimed_at < now() - make_interval(mins => :max_minutes))
    returning id
""")

_CLAIM = text("""
    update public.concept_backlog b
       set status = 'generating', attempts = b.attempts + 1, claimed_at = now(), claim_token = gen_random_uuid()
      from public.topics t, public.subtopics s
     where b.id = (
         select b2.id from public.concept_backlog b2
          where b2.status = 'pending'
            and exists(select 1 from public.topics active where active.id=b2.topic_id and active.is_active)
            and exists(select 1 from public.subtopics active where active.id=b2.subtopic_id
              and active.topic_id=b2.topic_id and active.is_active)
            and (cast(:topic_id as uuid) is null or b2.topic_id = cast(:topic_id as uuid))
            and b2.attempts < 3 + (select count(*) from public.content_retry_log r where r.backlog_id=b2.id)
          order by b2.created_at
          for update skip locked
          limit 1
     )
       and t.id = b.topic_id
       and s.id = b.subtopic_id
       and s.topic_id = b.topic_id
       and s.is_active
    returning b.id, b.claim_token, b.slug, b.title, b.angle, b.difficulty, b.topic_id, b.subtopic_id,
              b.curriculum, t.name as topic_name, s.slug as subtopic_slug,
              s.name as subtopic_name
""")

_PUBLISH = text("""
    with inserted as (
        insert into public.concepts
            (topic_id, subtopic_id, slug, title, summary, example, difficulty,
             status, source, model, prompt_version, curriculum, content_version)
        values (:topic_id, :subtopic_id, :slug, :title, :summary, :example, :difficulty,
                'draft', 'gemini', :model, :prompt_version, cast(:curriculum as jsonb), 0)
        on conflict (slug) do nothing
        returning *
    ), revision as (
        insert into public.concept_revisions(concept_id,base_version,body)
        select id,0,jsonb_build_object('title',title,'summary',summary,'example',example,
          'subtopic_slug',cast(:subtopic_slug as text),'curriculum',curriculum,
          'model',model,'prompt_version',prompt_version,
          'learning_package',cast(:learning_package as jsonb))
        from inserted returning id
    )
    update public.concept_backlog
       -- Mark done ONLY when a concept was actually inserted. A slug collision
       -- makes the insert a no-op; marking the row done anyway would retire the
       -- title having burned a Gemini call without ever publishing (issue #37).
       set status = case when exists (select 1 from inserted) then 'done' else 'failed' end,
           last_error = case when exists (select 1 from inserted) then null
                             else 'slug already exists; nothing published' end,
           claimed_at = null, claim_token = null
     where id = :backlog_id and status='generating' and claim_token=:claim_token
    returning (select id from inserted) as concept_id
""")

_FAIL = text("""
    update public.concept_backlog
       set status = case when attempts >= 3 + (select count(*) from public.content_retry_log r where r.backlog_id=concept_backlog.id) then 'failed' else 'pending' end,
           last_error = :error, claimed_at = null, claim_token = null
     where id = :backlog_id and status='generating' and claim_token=:claim_token
""")

# A rate limit is our problem, not the title's: return it to the queue and
# refund the attempt so throttling can never retire an item.
_RELEASE = text("""
    update public.concept_backlog
       set status = 'pending', attempts = greatest(attempts - 1, 0), claimed_at = null, claim_token = null
     where id = :backlog_id and status='generating' and claim_token=:claim_token
""")


@dataclass
class TopUpResult:
    generated: int
    failed: int
    skipped_reason: str | None = None


_FUTURE_REFILL_DEMAND = text("""
    with active as (
      select distinct user_id from public.daily_assignments
       where assigned_at>=now()-make_interval(days=>:days)
      union
      select user_id from public.daily_reviews
       where assigned_at>=now()-make_interval(days=>:days)
    )
    select
      exists(select 1 from public.content_supply_targets s
        where s.topic_id=:topic_id and s.expires_at>now()) as requested,
      coalesce((
        select min((select count(*) from public.concepts c
          join public.subtopics s on s.id=c.subtopic_id and s.is_active
          where c.topic_id=:topic_id and c.status='published'
            and not exists(select 1 from public.daily_assignments a
              where a.user_id=active.user_id and a.concept_id=c.id)))::int
        from active join public.user_topics ut on ut.user_id=active.user_id
        where ut.topic_id=:topic_id
      ), 0)::int as unread
""")


async def future_refill_state(session: AsyncSession, topic_id: uuid.UUID) -> tuple[bool, int]:
    """Return durable low-supply demand and the lowest active learner inventory."""
    row = (
        await session.execute(
            _FUTURE_REFILL_DEMAND,
            {"topic_id": topic_id, "days": get_settings().content_active_days},
        )
    ).one()
    return bool(row.requested), row.unread


async def generate_one(
    session: AsyncSession,
    api_key: str,
    model: str,
    topic_id: uuid.UUID | None = None,
    *,
    call_cap: int | None = None,
    supply_target: int | None = None,
    future_refill: bool = False,
    future_refill_global_cap: int | None = None,
    future_refill_topic_cap: int | None = None,
) -> uuid.UUID | None:
    """Claim a title and daily budget together, then generate outside the transaction."""
    cap = get_settings().generation_daily_call_cap if call_cap is None else call_cap
    try:
        if supply_target is not None and topic_id is not None:
            # Serialize capacity checks and claims, then release before model I/O.
            active = await session.scalar(
                text("select is_active from public.topics where id=:t for update"),
                {"t": topic_id},
            )
            inventory = await session.scalar(
                text("""select
              (select count(*) from public.concepts c join public.subtopics s
                 on s.id=c.subtopic_id and s.is_active
               where c.topic_id=:t and c.status in ('published','draft')) +
              (select count(*) from public.concept_backlog b join public.subtopics s
                 on s.id=b.subtopic_id and s.is_active
               where b.topic_id=:t and b.status='generating')"""),
                {"t": topic_id},
            )
            if not active or inventory >= supply_target:
                await session.commit()
                return None
        claimed = (await session.execute(_CLAIM, {"topic_id": topic_id})).first()
        if claimed is not None:
            if future_refill:
                if future_refill_global_cap is None or future_refill_topic_cap is None:
                    raise ValueError("future refill caps are required")
                await reserve_future_refill_call(
                    session,
                    claimed.topic_id,
                    global_cap=future_refill_global_cap,
                    topic_cap=future_refill_topic_cap,
                )
            else:
                await reserve_generation_call(session, cap)
            await check_generation_capacity(session)
            # The shared quota lock serializes all provider claimers. Include
            # this claim in the load, then roll back it and quota if full.
            if (
                await review_load(session, claimed.topic_id)
                > get_settings().content_review_backlog_limit
            ):
                await session.rollback()
                return None
        await session.commit()
    except BaseException:
        # Quota denial/DB failure/cancellation must undo the claim and its attempt.
        # Once committed, a call's quota reservation is never refunded.
        await session.rollback()
        raise
    if claimed is None:
        return None

    # After the commit above no transaction is open, so nothing is pinned on the
    # pooler while Gemini works — the topic name rode along on the claim.
    try:
        result = await generate_concept(
            title=claimed.title,
            topic_name=claimed.topic_name,
            subtopic_name=claimed.subtopic_name,
            angle="\n".join(
                filter(
                    None,
                    [
                        claimed.angle,
                        f"Learning objective: {claimed.curriculum['objective']}"
                        if claimed.curriculum.get("objective")
                        else None,
                        f"Difficulty: {claimed.difficulty or 1}. Prerequisites: {claimed.curriculum.get('prerequisites', [])}",
                        f"Editorial references: {claimed.curriculum.get('references', [])}",
                    ],
                )
            ),
            api_key=api_key,
            model=model,
        )
    except RateLimitedError:
        await session.execute(
            _RELEASE, {"backlog_id": claimed.id, "claim_token": claimed.claim_token}
        )
        await session.commit()
        raise
    except GenerationError as exc:
        # Leave it pending for another attempt; give up after three so one bad
        # title cannot block the queue forever.
        log.warning(
            "generation failed for %s (%s); inspect the protected backlog",
            claimed.slug,
            type(exc).__name__,
        )
        await session.execute(
            _FAIL,
            {
                "backlog_id": claimed.id,
                "claim_token": claimed.claim_token,
                "error": "provider_error",
            },
        )
        await session.commit()
        return None

    # Lock and fence before inserting anything: an expired worker must not
    # complete another worker's newer claim or create an obsolete draft.
    await catalog_lock(session)
    live = await session.scalar(
        text("""select b.id from concept_backlog b
      join topics t on t.id=b.topic_id join subtopics s on s.id=b.subtopic_id
      where b.id=:id and b.status='generating' and b.claim_token=:token
        and t.is_active and s.is_active for update of b"""),
        {"id": claimed.id, "token": claimed.claim_token},
    )
    if live is None:
        await session.rollback()
        return None
    concept_id = (
        await session.execute(
            _PUBLISH,
            {
                "topic_id": claimed.topic_id,
                "subtopic_id": claimed.subtopic_id,
                "subtopic_slug": claimed.subtopic_slug,
                "slug": claimed.slug,
                "title": claimed.title,
                "summary": result.summary,
                "example": result.example,
                "difficulty": claimed.difficulty,
                "model": result.model,
                "prompt_version": result.prompt_version,
                "backlog_id": claimed.id,
                "claim_token": claimed.claim_token,
                "curriculum": json.dumps(claimed.curriculum),
                "learning_package": result.learning_package.model_dump_json(),
            },
        )
    ).scalar_one_or_none()
    await session.commit()
    if concept_id is not None:
        log.info("drafted %s", claimed.slug)
    else:
        # The insert was a no-op (slug already exists); _PUBLISH marked the row
        # failed rather than done, so the title is flagged, not silently retired.
        log.warning("not published (slug %s already exists)", claimed.slug)
    return concept_id


async def _future_refill_top_up(
    session: AsyncSession,
    *,
    api_key: str,
    model: str,
    minimum_per_topic: int,
    pace_seconds: float,
) -> TopUpResult:
    """Give each low topic one fair normal slot, then an optional urgent slot."""
    settings = get_settings()
    generated = failed = 0
    topics = (await session.execute(_POOL_COUNTS)).all()
    passes = [(False, settings.future_refill_daily_call_cap, settings.future_refill_topic_daily_cap)]
    if settings.future_refill_urgent_enabled:
        passes.append((True, settings.future_refill_urgent_daily_call_cap,
                       settings.future_refill_urgent_topic_daily_cap))

    for urgent, global_cap, topic_cap in passes:
        for topic in topics:
            requested, unread = await future_refill_state(session, topic.id)
            threshold = (
                settings.content_critical_watermark
                if urgent
                else settings.content_low_watermark
            )
            if not requested or unread > threshold:
                continue
            target = await target_for(session, topic.id, minimum_per_topic)
            if topic.published >= target or not topic.pending:
                continue
            if await slots_available(session, topic.id) <= 0:
                log.info("future refill for topic %s skipped: review capacity full", topic.slug)
                continue
            try:
                concept_id = await generate_one(
                    session,
                    api_key,
                    model,
                    topic.id,
                    supply_target=target,
                    future_refill=True,
                    future_refill_global_cap=global_cap,
                    future_refill_topic_cap=topic_cap,
                )
            except FutureRefillBudgetExhausted as exc:
                if exc.scope == "global":
                    log.info("future refill stopped: global daily allowance reached")
                    return TopUpResult(generated, failed, "future refill daily allowance reached")
                log.info("future refill for topic %s skipped: topic allowance reached", topic.slug)
                continue
            except GenerationBusy:
                return TopUpResult(generated, failed, "generation capacity busy")
            except RateLimitedError:
                log.warning("future refill stopped: provider rate limited")
                return TopUpResult(generated, failed, "rate limited")
            if concept_id is None:
                failed += 1
            else:
                generated += 1
            if pace_seconds:
                await asyncio.sleep(pace_seconds)
    return TopUpResult(generated, failed)


async def top_up(
    session: AsyncSession,
    *,
    api_key: str,
    model: str,
    enabled: bool,
    minimum_per_topic: int,
    call_cap: int,
    pace_seconds: float = 0.0,
    future_refill: bool = False,
) -> TopUpResult:
    """Refill curated future-card supply without exceeding review capacity."""
    if not enabled:
        return TopUpResult(0, 0, "generation disabled")
    if not api_key:
        return TopUpResult(0, 0, "no API key configured")

    # Start every run by reclaiming rows a previous worker abandoned mid-flight,
    # so a crash cannot permanently lose a title from the pool (issue #37).
    reaped = (
        await session.execute(_REAP_STALE, {"max_minutes": STALE_CLAIM_MINUTES})
    ).all()
    await session.commit()
    if reaped:
        log.warning("reclaimed %s stale 'generating' backlog rows", len(reaped))

    if future_refill:
        return await _future_refill_top_up(
            session,
            api_key=api_key,
            model=model,
            minimum_per_topic=minimum_per_topic,
            pace_seconds=pace_seconds,
        )

    generated = failed = 0
    backoff = BACKOFF_START_SECONDS
    rate_limit_streak = 0
    for topic in (await session.execute(_POOL_COUNTS)).all():
        target = await target_for(session, topic.id, minimum_per_topic)
        deficit = target - topic.published
        if deficit <= 0:
            continue
        remaining = min(
            deficit,
            topic.pending,
            get_settings().content_generation_batch,
            await slots_available(session, topic.id),
        )
        while remaining > 0:
            try:
                concept_id = await generate_one(
                    session,
                    api_key,
                    model,
                    topic.id,
                    call_cap=call_cap,
                    supply_target=target,
                )
            except GenerationBusy:
                return TopUpResult(generated, failed, "generation capacity busy")
            except GenerationBudgetExhausted:
                log.info("stopping: shared daily call cap of %s reached", call_cap)
                return TopUpResult(generated, failed, "daily call cap reached")
            except RateLimitedError as exc:
                rate_limit_streak += 1
                if rate_limit_streak >= MAX_CONSECUTIVE_RATE_LIMITS:
                    log.warning(
                        "stopping: %s consecutive rate limits", rate_limit_streak
                    )
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
