"""Likes, saves, completion, and topic follows — every write the app makes."""

import uuid

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


_COMPLETE = text("""
    update public.daily_assignments
       set completed_at = coalesce(completed_at, now())
     where user_id = :uid and assigned_for = :today
    returning completed_at
""")


async def complete_today(session: AsyncSession, user_id: uuid.UUID, today) -> str:
    """Mark today's concept learned. The timestamp is the server's, not the client's."""
    completed = (await session.execute(_COMPLETE, {"uid": user_id, "today": today})).scalar_one_or_none()
    if completed is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="No concept has been assigned for today yet. Fetch /v1/daily first.",
        )
    await session.commit()
    return completed


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
