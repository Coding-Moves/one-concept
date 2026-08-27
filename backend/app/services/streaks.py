"""Streak calculation.

Always derived from completion dates, never stored as a counter and never
accepted from the client. `assigned_for` is stamped from the user's timezone at
assignment time and never rewritten, so travelling does not retroactively
rewrite history.
"""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class StreakStats:
    current: int
    longest: int
    total_learned: int


# Gaps and islands: consecutive dates share (date - row_number()), so each
# island is one unbroken run of days.
_STREAKS = text("""
    with days as (
        select distinct assigned_for as d
          from public.daily_assignments
         where user_id = :uid and completed_at is not null
    ), grouped as (
        select d, d - (row_number() over (order by d))::int as grp from days
    ), runs as (
        select grp, count(*)::int as len, max(d) as ends_on
          from grouped group by grp
    )
    select
      coalesce((select len from runs
                 where ends_on in (:today, :yesterday)
                 order by ends_on desc limit 1), 0) as current,
      coalesce((select max(len) from runs), 0)      as longest,
      (select count(*)::int from days)              as total_learned
""")

_TODAY = text("""
    select (now() at time zone timezone)::date as today
      from public.profiles where id = :uid
""")


async def local_today(session: AsyncSession, user_id: uuid.UUID) -> date:
    return (await session.execute(_TODAY, {"uid": user_id})).one().today


async def compute_streaks(
    session: AsyncSession, user_id: uuid.UUID, today: date | None = None
) -> StreakStats:
    if today is None:
        today = await local_today(session, user_id)
    row = (
        await session.execute(
            _STREAKS,
            {"uid": user_id, "today": today, "yesterday": today - timedelta(days=1)},
        )
    ).one()
    # A run ending yesterday still counts as current, so an unfinished today
    # never shows the user a broken streak before the day is over.
    return StreakStats(current=row.current, longest=row.longest, total_learned=row.total_learned)
