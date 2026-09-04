"""Likes, saves, completion, and topic follows — every write the app makes."""

import uuid
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_CONCEPT_ID = text("select id from public.concepts where slug = :slug and status = 'published'")


async def resolve_concept(session: AsyncSession, slug: str) -> uuid.UUID:
    concept_id = (await session.execute(_CONCEPT_ID, {"slug": slug})).scalar_one_or_none()
    if concept_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"No concept with slug {slug!r}")
    return concept_id


async def set_interaction(
    session: AsyncSession, user_id: uuid.UUID, slug: str, field: str, on: bool
) -> None:
    """Toggle `liked_at` or `saved_at`. Idempotent: repeating a call is a no-op."""
    assert field in {"liked_at", "saved_at"}
    concept_id = await resolve_concept(session, slug)
    value = "now()" if on else "null"
    await session.execute(
        text(f"""
            insert into public.concept_interactions (user_id, concept_id, {field})
            values (:uid, :cid, {value})
            on conflict (user_id, concept_id) do update
              set {field} = {value}, updated_at = now()
        """),
        {"uid": user_id, "cid": concept_id},
    )
    await session.commit()


# Complete the most recent assignment from today or yesterday. The one-day
# grace covers the midnight crossing: a concept read at 23:58 and marked at
# 00:01 has no assignment for the new day yet, so a strict `= today` match
# updated zero rows and the day's streak broke (issue #33). The window stops
# at yesterday, so a genuinely missed older day cannot be back-completed to
# repair a streak. `coalesce` keeps completion idempotent, and the actual
# `assigned_for` is returned so the caller reports the day it counts for.
_COMPLETE = text("""
    update public.daily_assignments
       set completed_at = coalesce(completed_at, now())
     where id = (
         select id from public.daily_assignments
          where user_id = :uid
            and assigned_for in (cast(:today as date), cast(:today as date) - 1)
          order by assigned_for desc
          limit 1
     )
    returning assigned_for
""")


@dataclass
class Completion:
    # The day the completion counts towards — today's normally, yesterday's
    # when the grace window catches a just-past-midnight tap.
    assigned_for: date


async def complete_today(session: AsyncSession, user_id: uuid.UUID, today) -> Completion:
    """Mark the current (or just-past-midnight) concept learned.

    The completion timestamp is the server's, not the client's; the returned
    `assigned_for` is the day it counts towards.
    """
    row = (await session.execute(_COMPLETE, {"uid": user_id, "today": today})).first()
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="No concept has been assigned recently. Fetch /v1/daily first.",
        )
    await session.commit()
    return Completion(assigned_for=row.assigned_for)


async def set_followed_topics(
    session: AsyncSession, user_id: uuid.UUID, slugs: list[str]
) -> list[str]:
    """Replace the followed set. Whole-list semantics keep this idempotent."""
    rows = (
        await session.execute(
            text("select id, slug from public.topics where slug = any(:slugs) and is_active"),
            {"slugs": slugs},
        )
    ).all()

    found = {r.slug for r in rows}
    unknown = set(slugs) - found
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Unknown topics: {sorted(unknown)}"
        )

    keep = [r.id for r in rows]
    # One round trip rather than one per topic: latency to the database region
    # dominates, so the number of statements matters more than their cost.
    await session.execute(
        text("""
            with removed as (
                delete from public.user_topics
                 where user_id = :uid and topic_id <> all(:keep)
            )
            insert into public.user_topics (user_id, topic_id)
            select :uid, unnest(cast(:keep as uuid[]))
            on conflict do nothing
        """),
        {"uid": user_id, "keep": keep},
    )
    await session.commit()
    return sorted(found)
