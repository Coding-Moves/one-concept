"""Backend-only operational snapshot. No user IDs or raw provider errors escape."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

_FAILURE_CATEGORY = """case
  when last_error like '%slug%' then 'slug_collision'
  when last_error ~* 'summary|example|json|length|style|schema' then 'content_validation'
  when last_error ~* 'timeout|connect|network' then 'provider_transport'
  when last_error ~* '429|rate.limit' then 'provider_throttled'
  when last_error ~* '(http|gemini).*[45][0-9][0-9]' then 'provider_http'
  else 'other_or_unclassified' end"""


async def failed_items(session: AsyncSession, after: str = "") -> list[dict]:
    rows = await session.execute(
        text(f"""select b.slug,t.slug as topic,b.title,
      b.attempts,b.updated_at,{_FAILURE_CATEGORY} as category,
      (select count(*) from public.content_retry_log r where r.backlog_id=b.id) as retry_grants
      from public.concept_backlog b join public.topics t on t.id=b.topic_id
      where b.status='failed' and b.slug>:after order by b.slug limit 100"""),
        {"after": after},
    )
    return [dict(r) for r in rows.mappings()]


_REPORT = text("""with active as (
  select user_id from public.daily_assignments where assigned_at>=now()-make_interval(days=>:days)
  union select user_id from public.daily_reviews where assigned_at>=now()-make_interval(days=>:days)
), consumed as (
  select ut.topic_id,max(seen.n)::int as max_assigned from active a
  join public.user_topics ut on ut.user_id=a.user_id
  left join lateral (select count(*) as n from public.daily_assignments da
    join public.concepts c on c.id=da.concept_id where da.user_id=a.user_id
    and c.topic_id=ut.topic_id and c.status='published') seen on true group by ut.topic_id
)
select t.slug,t.is_active,
  (select count(*) from public.concepts c where c.topic_id=t.id and status='published')::int as published,
  (select count(*) from public.concepts c where c.topic_id=t.id and status='draft')::int as drafts,
  (select count(*) from public.concept_revisions r join public.concepts c on c.id=r.concept_id
    where c.topic_id=t.id and r.status='draft')::int as revisions_awaiting_review,
  (select count(*) from public.concept_backlog b where b.topic_id=t.id and status='pending'
    and attempts<3+(select count(*) from public.content_retry_log l where l.backlog_id=b.id))::int as pending,
  (select count(*) from public.concept_backlog b where b.topic_id=t.id and (status='failed'
    or (status='pending' and attempts>=3+(select count(*) from public.content_retry_log l where l.backlog_id=b.id))))::int as failed,
  (select count(*) from public.concept_backlog b where b.topic_id=t.id and status='generating')::int as generating,
  (select count(*) from public.concept_backlog b where b.topic_id=t.id and status='generating'
    and (claimed_at is null or claimed_at<now()-interval '30 minutes'))::int as stale,
  (select max(created_at) from public.concepts c where c.topic_id=t.id and source='gemini') as last_generated_at,
  (select max(published_at) from public.concepts c where c.topic_id=t.id) as last_published_at,
  coalesce(consumed.max_assigned,0) as experienced_assigned,
  greatest(:floor,coalesce((select target_count from public.content_supply_targets s
    where s.topic_id=t.id and s.expires_at>now()),0)) as target
from public.topics t left join consumed on consumed.topic_id=t.id order by t.sort_order,t.slug""")


async def health_report(session: AsyncSession) -> dict:
    settings = get_settings()
    rows = (
        (
            await session.execute(
                _REPORT,
                {
                    "days": settings.content_active_days,
                    "floor": settings.min_pool_per_topic,
                },
            )
        )
        .mappings()
        .all()
    )
    topics = []
    conditions = set()
    for row in rows:
        topic = dict(row)
        topic["unseen_for_experienced_reader"] = max(
            0, row["published"] - row["experienced_assigned"]
        )
        # Conservative one lesson/subject/day. This is a stock estimate, not a
        # promise of publication dates or measured per-reader consumption speed.
        topic["estimated_reserve_days"] = topic["unseen_for_experienced_reader"]
        topics.append(topic)
        if not row["is_active"]:
            continue
        for name, active in {
            "low_reserve": topic["estimated_reserve_days"]
            <= settings.content_low_watermark,
            "below_reserve_target": topic["estimated_reserve_days"]
            < settings.content_reserve_per_topic,
            "empty_queue": row["pending"] == 0,
            "low_planned_reserve": row["pending"] < settings.content_planned_reserve,
            "failed_generation": row["failed"] > 0,
            "stale_claims": row["stale"] > 0,
            "awaiting_review": row["revisions_awaiting_review"] > 0,
        }.items():
            if active:
                conditions.add(f"{row['slug']}:{name}")
    used = await session.scalar(
        text(
            "select coalesce((select calls_used from public.generation_daily_usage where budget_day=(statement_timestamp() at time zone 'America/Los_Angeles')::date),0)"
        )
    )
    worker = (
        (
            await session.execute(
                text(
                    "select *,finished_at<now()-interval '36 hours' as overdue from public.content_worker_runs where worker='pool_topup'"
                )
            )
        )
        .mappings()
        .first()
    )
    if not settings.generation_enabled:
        conditions.add("generation_disabled")
    if not settings.gemini_api_key:
        conditions.add("generation_key_missing")
    if used >= settings.generation_daily_call_cap:
        conditions.add("daily_budget_exhausted")
    if (
        not worker
        or worker["finished_at"] is None
        or worker["overdue"]
        or worker["outcome"] == "failed"
    ):
        conditions.add("scheduled_worker_needs_attention")
    corrections = (
        (
            await session.execute(
                text("""select count(*)::int as generating,
      count(*) filter(where created_at<now()-interval '30 minutes')::int as stale
      from public.concept_revisions where status='generating'""")
            )
        )
        .mappings()
        .one()
    )
    if corrections["stale"]:
        conditions.add("stale_correction_drafts")
    # Categorize failures in SQL; never emit last_error text (which may include
    # provider response fragments) or private reader identifiers.
    failures = (
        (
            await session.execute(
                text(f"""select {_FAILURE_CATEGORY} as category,count(*)::int as count
                  from public.concept_backlog where status='failed' group by 1 order by 1""")
            )
        )
        .mappings()
        .all()
    )
    return {
        "topics": topics,
        "conditions": sorted(conditions),
        "failure_categories": [dict(r) for r in failures],
        "budget": {
            "reserved_calls": used,
            "configured_cap": settings.generation_daily_call_cap,
            "timezone": "America/Los_Angeles",
        },
        "worker": dict(worker) if worker else None,
        "correction_drafting": dict(corrections),
        "policy": {
            "active_days": settings.content_active_days,
            "reserve": settings.content_reserve_per_topic,
            "planned_reserve": settings.content_planned_reserve,
            "batch": settings.content_generation_batch,
            "max_concurrent": settings.generation_max_concurrent,
        },
    }


async def observe_conditions(
    session: AsyncSession, conditions: list[str]
) -> list[dict]:
    """Return transitions once, including recovery; caller commits before emitting."""
    await session.execute(text("select pg_advisory_xact_lock(195,2)"))
    previous = dict(
        (
            await session.execute(
                text("select key,active from public.content_conditions")
            )
        ).all()
    )
    active = set(conditions)
    transitions = []
    for key in sorted(set(previous) | active):
        value = key in active
        if previous.get(key, False) != value:
            transitions.append(
                {"condition": key, "state": "active" if value else "recovered"}
            )
        await session.execute(
            text("""insert into public.content_conditions(key,active) values (:k,:v)
          on conflict(key) do update set active=excluded.active,observed_at=now(),
            changed_at=case when content_conditions.active<>excluded.active then now() else content_conditions.changed_at end"""),
            {"k": key, "v": value},
        )
    return transitions
