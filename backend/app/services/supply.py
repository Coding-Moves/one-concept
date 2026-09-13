"""Durable, coalesced demand. Publication cannot inflate a reader's target.

The target is assigned published concepts + a reserve. Adding a new published
concept increases both the catalog and unread supply, leaving this target fixed.
Only consumption, not repeated GETs or a second handset, advances it.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

_SIGNAL = text("""
  with inventory as (
    select count(*)::int as published,
      count(*) filter (where exists (select 1 from public.daily_assignments a
        where a.user_id=:uid and a.concept_id=c.id))::int as assigned
    from public.concepts c join public.topics t on t.id=c.topic_id
    where c.topic_id=:tid and c.status='published' and t.is_active
  )
  insert into public.content_supply_targets(topic_id,target_count,expires_at)
  select :tid, assigned+:reserve, now()+make_interval(days=>:active_days)
    from inventory where published-assigned<=:low
      and exists(select 1 from public.topics where id=:tid and is_active)
  on conflict(topic_id) do update set
    target_count=greatest(content_supply_targets.target_count,excluded.target_count),
    requested_at=now(), expires_at=excluded.expires_at
""")


async def signal_reader(
    session: AsyncSession, user_id: uuid.UUID, topic_id: uuid.UUID
) -> None:
    settings = get_settings()
    await session.execute(
        _SIGNAL,
        {
            "uid": user_id,
            "tid": topic_id,
            "reserve": settings.content_reserve_per_topic,
            "low": settings.content_low_watermark,
            "active_days": settings.content_active_days,
        },
    )
    await session.commit()


async def plan_active_readers(session: AsyncSession) -> None:
    """One aggregate per scheduled run, never a scan of every user on a GET."""
    settings = get_settings()
    await session.execute(
        text("""
      with active as (
        select distinct user_id from public.daily_assignments
        where assigned_at>=now()-make_interval(days=>:days)
      ), demand as (
        select ut.topic_id, coalesce(max(seen.n),0)::int+:reserve as target
        from active a join public.user_topics ut on ut.user_id=a.user_id
        join public.topics t on t.id=ut.topic_id and t.is_active
        left join lateral (
          select count(*) as n from public.daily_assignments da
          join public.concepts c on c.id=da.concept_id
          where da.user_id=a.user_id and c.topic_id=ut.topic_id and c.status='published'
        ) seen on true group by ut.topic_id
      )
      insert into public.content_supply_targets(topic_id,target_count,expires_at)
      select topic_id,target,now()+make_interval(days=>:days) from demand
      on conflict(topic_id) do update set target_count=excluded.target_count,
        requested_at=now(),expires_at=excluded.expires_at
    """),
        {
            "days": settings.content_active_days,
            "reserve": settings.content_reserve_per_topic,
        },
    )
    await session.commit()


async def target_for(session: AsyncSession, topic_id: uuid.UUID, floor: int = 0) -> int:
    return await session.scalar(
        text("""select greatest(:floor,coalesce(
      (select target_count from public.content_supply_targets
       where topic_id=:tid and expires_at>now()),0))"""),
        {"tid": topic_id, "floor": floor},
    )
