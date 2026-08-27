"""The aggregate the mobile app loads on start.

Deliberately one round trip. The client needs followed topics, learning
history, likes, saves, today's assignment, and streaks together before it can
render anything, and when the database sits in another region the number of
round trips — not the cost of each query — is what the user feels.
"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.streaks import StreakStats


@dataclass
class LearnedRecord:
    concept_slug: str
    learned_on: date


@dataclass
class UserState:
    timezone: str
    today: date
    followed_topics: list[str]
    learned: list[LearnedRecord]
    likes: list[str]
    bookmarks: list[str]
    stats: StreakStats
    assignment_slug: str | None = None
    display_name: str | None = None


_STATE = text("""
    with prof as (
        select display_name, timezone, (now() at time zone timezone)::date as today
          from public.profiles where id = :uid
    ),
    followed as (
        select coalesce(json_agg(t.slug order by t.sort_order), '[]'::json) as v
          from public.user_topics ut
          join public.topics t on t.id = ut.topic_id
         where ut.user_id = :uid and t.is_active
    ),
    learned_rows as (
        select c.slug, a.assigned_for
          from public.daily_assignments a
          join public.concepts c on c.id = a.concept_id
         where a.user_id = :uid and a.completed_at is not null
    ),
    learned as (
        select coalesce(json_agg(json_build_object('slug', slug, 'on', assigned_for)
                                 order by assigned_for desc), '[]'::json) as v
          from learned_rows
    ),
    interactions as (
        select
          coalesce(json_agg(c.slug) filter (where i.liked_at is not null), '[]'::json) as likes,
          coalesce(json_agg(c.slug) filter (where i.saved_at is not null), '[]'::json) as saves
          from public.concept_interactions i
          join public.concepts c on c.id = i.concept_id
         where i.user_id = :uid
    ),
    assignment as (
        select c.slug
          from public.daily_assignments a
          join public.concepts c on c.id = a.concept_id
         where a.user_id = :uid and a.assigned_for = (select today from prof)
    ),
    -- Gaps and islands: consecutive dates share (date - row_number()).
    days as (select distinct assigned_for as d from learned_rows),
    grouped as (select d, d - (row_number() over (order by d))::int as grp from days),
    runs as (select grp, count(*)::int as len, max(d) as ends_on from grouped group by grp)
    select
      prof.display_name,
      prof.timezone,
      prof.today,
      followed.v      as followed_topics,
      learned.v       as learned,
      interactions.likes,
      interactions.saves,
      (select slug from assignment) as assignment_slug,
      coalesce((select len from runs
                 where ends_on in (prof.today, prof.today - 1)
                 order by ends_on desc limit 1), 0) as current_streak,
      coalesce((select max(len) from runs), 0)      as longest_streak,
      (select count(*)::int from days)              as total_learned
      from prof, followed, learned, interactions
""")


async def load_state(session: AsyncSession, user_id: uuid.UUID) -> UserState | None:
    """Returns None when the user has no profile row yet, so the caller can
    bootstrap and retry — keeping the common path to a single query."""
    row = (await session.execute(_STATE, {"uid": user_id})).first()
    if row is None:
        return None

    return UserState(
        display_name=row.display_name,
        timezone=row.timezone,
        today=row.today,
        followed_topics=list(row.followed_topics),
        learned=[
            LearnedRecord(concept_slug=r["slug"], learned_on=date.fromisoformat(r["on"]))
            for r in row.learned
        ],
        likes=list(row.likes),
        bookmarks=list(row.saves),
        stats=StreakStats(
            current=row.current_streak,
            longest=row.longest_streak,
            total_learned=row.total_learned,
        ),
        assignment_slug=row.assignment_slug,
    )
