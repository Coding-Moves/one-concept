"""Server-issued awards. Caller holds the profile lock and owns the transaction."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.streaks import compute_streaks

_AWARD_STREAKS = text("""
    with days as (
        select assigned_for as d from public.daily_assignments
        where user_id=:uid and completed_at is not null
        union select assigned_for from public.daily_reviews
        where user_id=:uid and completed_at is not null
    ), islands as (
        select d,d-(row_number() over(order by d))::int as grp from days
    ), lengths as (
        select d,row_number() over(partition by grp order by d) as length from islands
    )
    insert into public.user_achievements(user_id,achievement_code,earned_on,source)
    select :uid,a.code,min(l.d),:source from lengths l
    join public.achievement_definitions a
      on a.metric='consecutive_days' and l.length=a.threshold
    group by a.code
    on conflict(user_id,achievement_code) do nothing
""")


async def award_streaks(
    session: AsyncSession, user_id: uuid.UUID, *, historical: bool = False,
) -> None:
    # No commit here: an award and its accepted completion must succeed or fail
    # together. Replay preserves the original earned date and seen state.
    await session.execute(_AWARD_STREAKS, {"uid": user_id, "source": "history" if historical else "completion"})


async def collection(session: AsyncSession, user_id: uuid.UUID) -> dict:
    # Same lock as completion: badges and progress describe one consistent state.
    await session.execute(text("select id from public.profiles where id=:uid for update"), {"uid": user_id})
    # Reconcile learning accepted by an older API during deployment, or newly
    # added definitions. Historical credit must not require another completion.
    await award_streaks(session, user_id, historical=True)
    stats = await compute_streaks(session, user_id)
    rows = await session.execute(text("""
        select a.code,a.metric,a.threshold,a.name,a.description,a.artwork_key,
               u.earned_on,u.source,u.seen_at
        from public.achievement_definitions a
        left join public.user_achievements u on u.achievement_code=a.code and u.user_id=:uid
        order by a.sort_order,a.code
    """), {"uid": user_id})
    return {"current_streak": stats.current, "longest_streak": stats.longest,
            "items": [dict(row) for row in rows.mappings()]}


async def acknowledge(session: AsyncSession, user_id: uuid.UUID, codes: list[str]) -> None:
    # Never grants an award; only acknowledges existing rows owned by the JWT user.
    await session.execute(text("""
        update public.user_achievements set seen_at=coalesce(seen_at,now())
        where user_id=:uid and achievement_code=any(:codes)
    """), {"uid": user_id, "codes": codes})
