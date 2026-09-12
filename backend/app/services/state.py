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

from app.services.collections import STATE_WINDOW, saved_cursor
from app.services.streaks import StreakStats


@dataclass
class LearnedRecord:
    concept_slug: str
    learned_on: date
    title: str = ""
    topic_name: str = ""
    like_count: int = 0


@dataclass
class SavedConcept:
    concept_slug: str
    title: str = ""
    topic_name: str = ""
    like_count: int = 0


@dataclass
class UserState:
    timezone: str
    today: date
    followed_topics: list[str]
    learned: list[LearnedRecord]
    likes: list[str]
    bookmarks: list[str]
    # Saved concepts WITH their titles/topics, so the Profile can render the
    # saved list without the bundled demo catalog (which only covers a signed-out
    # user's 20 concepts). `bookmarks` stays as bare slugs for membership counts.
    saved: list[SavedConcept]
    stats: StreakStats
    learned_before_window: dict[str, int] | None = None
    history_next_cursor: str | None = None
    saved_next_cursor: str | None = None
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
        select c.id as concept_id, c.slug, c.title, t.name as topic_name, a.assigned_for
          from public.daily_assignments a
          join public.concepts c on c.id = a.concept_id
          join public.topics t on t.id = c.topic_id
         where a.user_id = :uid and a.completed_at is not null
    ),
    recent_learned_rows as materialized (
        select * from learned_rows order by assigned_for desc limit :window_limit
    ),
    older_counts as (
        select topic_name, count(*)::int as n from learned_rows
         where assigned_for < (select min(assigned_for) from recent_learned_rows)
         group by topic_name
    ),
    learned as (
        select coalesce(json_agg(json_build_object(
                   'slug', slug, 'title', title, 'topic', topic_name, 'on', assigned_for,
                   'likes', (select count(*) from public.concept_interactions ci
                              where ci.concept_id = recent_learned_rows.concept_id
                                and ci.liked_at is not null and ci.user_id <> :uid)::int)
                   order by assigned_for desc), '[]'::json) as v
          from recent_learned_rows
    ),
    interactions as (
        select
          coalesce(json_agg(c.slug) filter (where i.liked_at is not null), '[]'::json) as likes,
          coalesce(json_agg(c.slug) filter (where i.saved_at is not null), '[]'::json) as saves
          from public.concept_interactions i
          join public.concepts c on c.id = i.concept_id
         where i.user_id = :uid
    ),
    saved_rows as materialized (
        select concept_id, saved_at from public.concept_interactions
         where user_id = :uid and saved_at is not null
         order by saved_at desc, concept_id desc limit :window_limit
    ),
    saved as (
        select coalesce(json_agg(json_build_object(
                   'slug', c.slug, 'title', c.title, 'topic', t.name,
                   'at', i.saved_at, 'id', i.concept_id,
                   'likes', (select count(*) from public.concept_interactions ci
                              where ci.concept_id = c.id
                                and ci.liked_at is not null and ci.user_id <> :uid)::int)
                   order by i.saved_at desc, i.concept_id desc), '[]'::json) as v
          from saved_rows i
          join public.concepts c on c.id = i.concept_id
          join public.topics t on t.id = c.topic_id
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
      coalesce((select json_object_agg(topic_name, n) from older_counts),
               '{}'::json) as learned_before_window,
      interactions.likes,
      interactions.saves,
      saved.v         as saved,
      (select slug from assignment) as assignment_slug,
      coalesce((select len from runs
                 where ends_on in (prof.today, prof.today - 1)
                 order by ends_on desc limit 1), 0) as current_streak,
      coalesce((select max(len) from runs), 0)      as longest_streak,
      (select count(*)::int from days)              as total_learned
      from prof, followed, learned, interactions, saved
""")


async def load_state(session: AsyncSession, user_id: uuid.UUID, *, compact: bool = False) -> UserState | None:
    """Returns None when the user has no profile row yet, so the caller can
    bootstrap and retry — keeping the common path to a single query."""
    row = (await session.execute(_STATE, {
        "uid": user_id, "window_limit": STATE_WINDOW if compact else None,
    })).first()
    if row is None:
        return None

    return UserState(
        display_name=row.display_name,
        timezone=row.timezone,
        today=row.today,
        followed_topics=list(row.followed_topics),
        learned=[
            LearnedRecord(
                concept_slug=r["slug"],
                learned_on=date.fromisoformat(r["on"]),
                title=r.get("title", ""),
                topic_name=r.get("topic", ""),
                like_count=r.get("likes", 0),
            )
            for r in row.learned
        ],
        likes=list(row.likes),
        bookmarks=list(row.saves),
        saved=[
            SavedConcept(
                concept_slug=s["slug"],
                title=s.get("title", ""),
                topic_name=s.get("topic", ""),
                like_count=s.get("likes", 0),
            )
            for s in row.saved
        ],
        stats=StreakStats(
            current=row.current_streak,
            longest=row.longest_streak,
            total_learned=row.total_learned,
        ),
        learned_before_window=dict(row.learned_before_window) if compact else None,
        history_next_cursor=(row.learned[-1]["on"]
                             if compact and row.total_learned > len(row.learned) else None),
        saved_next_cursor=(saved_cursor(row.saved[-1]["at"], row.saved[-1]["id"])
                           if compact and len(row.saves) > len(row.saved) else None),
        assignment_slug=row.assignment_slug,
    )
