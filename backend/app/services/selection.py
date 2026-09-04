"""Daily concept selection.

The rules, in order:
  1. If today already has an assignment, return it unchanged — no reselection,
     no side effects, no LLM call.
  2. Otherwise pick from published concepts in the user's followed topics,
     excluding every concept already assigned to them.
  3. Rotate topics: prefer the topic the user has seen least recently, so a
     user following five topics gets a visibly varied week instead of whichever
     topic happens to hold the most content.
  4. Persist, tolerating the race where two devices ask at the same moment.

Generation never happens on this path. When a followed topic is running low, or
has just run dry, selection asks the prefetch service to top it up in the
background; the request itself only ever reads already-published rows (#43).
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.prefetch import LOW_WATERMARK, request_prefetch


@dataclass
class ConceptPayload:
    id: uuid.UUID
    slug: str
    title: str
    summary: str
    example: str | None
    topic_slug: str
    topic_name: str


@dataclass
class DailyResult:
    status: str  # "ok" | "exhausted"
    assigned_for: date | None = None
    assigned_at: datetime | None = None
    completed_at: datetime | None = None
    concept: ConceptPayload | None = None
    # True when the pool of followed topics was empty and we widened the search.
    outside_followed_topics: bool = False


_TODAY = text("""
    select timezone, (now() at time zone timezone)::date as today
      from public.profiles where id = :uid
""")

_EXISTING = text("""
    select a.assigned_for, a.assigned_at, a.completed_at,
           c.id, c.slug, c.title, c.summary, c.example,
           t.slug as topic_slug, t.name as topic_name
      from public.daily_assignments a
      join public.concepts c on c.id = a.concept_id
      join public.topics  t on t.id = c.topic_id
     where a.user_id = :uid and a.assigned_for = :today
""")

# Least-recently-seen topic first (never-seen topics sort first), then random
# within that topic.
_CANDIDATE = text("""
    with pool as (
        select c.id, c.topic_id
          from public.concepts c
         where c.status = 'published'
           and (:ignore_follows or c.topic_id in (
                 select topic_id from public.user_topics where user_id = :uid))
           and not exists (
                 select 1 from public.daily_assignments a
                  where a.user_id = :uid and a.concept_id = c.id)
    ),
    last_seen as (
        select c.topic_id, max(a.assigned_for) as seen_on
          from public.daily_assignments a
          join public.concepts c on c.id = a.concept_id
         where a.user_id = :uid
         group by c.topic_id
    )
    select p.id
      from pool p
      left join last_seen ls on ls.topic_id = p.topic_id
     order by ls.seen_on asc nulls first, random()
     limit 1
""")

_INSERT = text("""
    insert into public.daily_assignments (id, user_id, concept_id, assigned_for)
    values (gen_random_uuid(), :uid, :cid, :today)
    on conflict (user_id, assigned_for) do nothing
    returning id
""")


_FOLLOWED_TOPIC_BY_STALENESS = text("""
    select ut.topic_id
      from public.user_topics ut
      join public.topics t on t.id = ut.topic_id and t.is_active
      left join (
          select c.topic_id, max(a.assigned_for) as seen_on
            from public.daily_assignments a
            join public.concepts c on c.id = a.concept_id
           where a.user_id = :uid
           group by c.topic_id
      ) ls on ls.topic_id = ut.topic_id
     where ut.user_id = :uid
       and exists (select 1 from public.concept_backlog b
                    where b.topic_id = ut.topic_id and b.status = 'pending')
     order by ls.seen_on asc nulls first
     limit 1
""")


# Published concepts still unread by this user in the topic of the concept we
# just assigned. When this is low we prefetch that topic ahead of demand, so the
# pool refills before it ever runs dry — no generation on the request path.
_TOPIC_UNREAD = text("""
    with target as (select topic_id from public.concepts where id = :cid)
    select (select topic_id from target) as topic_id,
           (select count(*)
              from public.concepts c
             where c.status = 'published'
               and c.topic_id = (select topic_id from target)
               and not exists (
                   select 1 from public.daily_assignments a
                    where a.user_id = :uid and a.concept_id = c.id))::int as unread
""")


def _row_to_result(row, outside: bool) -> DailyResult:
    return DailyResult(
        status="ok",
        assigned_for=row.assigned_for,
        assigned_at=row.assigned_at,
        completed_at=row.completed_at,
        concept=ConceptPayload(
            id=row.id,
            slug=row.slug,
            title=row.title,
            summary=row.summary,
            example=row.example,
            topic_slug=row.topic_slug,
            topic_name=row.topic_name,
        ),
        outside_followed_topics=outside,
    )


async def get_or_create_daily(
    session: AsyncSession, user_id: uuid.UUID, *, today: date | None = None
) -> DailyResult:
    """`today` is derived from the user's timezone in production.

    The override exists so tests can walk a user through consecutive days, and
    so a future backfill can replay history; request handlers always pass None.
    """
    if today is None:
        today = (await session.execute(_TODAY, {"uid": user_id})).one().today

    existing = (await session.execute(_EXISTING, {"uid": user_id, "today": today})).first()
    if existing:
        return _row_to_result(existing, outside=False)

    # Followed topics first; widen to the whole catalog only if that pool is dry.
    outside = False
    concept_id = (
        await session.execute(_CANDIDATE, {"uid": user_id, "ignore_follows": False})
    ).scalar_one_or_none()

    if concept_id is None:
        # The followed pool is dry. Kick off a background top-up for the user's
        # stalest followed topic so coming days are covered, then widen to the
        # whole catalog for today — never block the response on Gemini (#43).
        stale_topic = (
            await session.execute(_FOLLOWED_TOPIC_BY_STALENESS, {"uid": user_id})
        ).scalar_one_or_none()
        if stale_topic is not None:
            request_prefetch(stale_topic)

        outside = True
        concept_id = (
            await session.execute(_CANDIDATE, {"uid": user_id, "ignore_follows": True})
        ).scalar_one_or_none()

    if concept_id is None:
        # Genuinely nothing left: every published concept is already assigned to
        # this user and generation could not add one. Say so rather than
        # repeating a concept.
        return DailyResult(status="exhausted", assigned_for=today)

    try:
        inserted = (
            await session.execute(
                _INSERT, {"uid": user_id, "cid": concept_id, "today": today}
            )
        ).scalar_one_or_none()
        await session.commit()
    except IntegrityError:
        # Another device won the race, or the concept was assigned concurrently.
        await session.rollback()
        inserted = None

    if inserted is None:
        row = (await session.execute(_EXISTING, {"uid": user_id, "today": today})).first()
        if row:
            return _row_to_result(row, outside=False)
        return DailyResult(status="exhausted", assigned_for=today)

    # Nearing the end of a followed topic? Top it up ahead of demand so the pool
    # refills before it ever runs dry — a fire-and-forget task, not a wait (#43).
    if not outside:
        watermark = (
            await session.execute(_TOPIC_UNREAD, {"uid": user_id, "cid": concept_id})
        ).first()
        if watermark and watermark.topic_id is not None and watermark.unread <= LOW_WATERMARK:
            request_prefetch(watermark.topic_id)

    row = (await session.execute(_EXISTING, {"uid": user_id, "today": today})).one()
    return _row_to_result(row, outside=outside)
