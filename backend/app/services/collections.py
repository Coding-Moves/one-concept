"""Bounded collection reads; cursor ordering survives deletions between pages."""

import base64
import binascii
import json
import uuid
from datetime import date, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.me import HistoryPageOut, LearnedOut, SavedConceptOut, SavedPageOut

STATE_WINDOW = 50


def saved_cursor(saved_at: str, concept_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([saved_at, concept_id]).encode()).decode().rstrip("=")


def parse_saved_cursor(cursor: str | None) -> tuple[datetime | None, uuid.UUID | None]:
    if cursor is None:
        return None, None
    try:
        timestamp, concept_id = json.loads(base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True,
        ))
        if not isinstance(timestamp, str) or not isinstance(concept_id, str):
            raise ValueError("Cursor fields must be strings")
        at = datetime.fromisoformat(timestamp)
        if at.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return at, uuid.UUID(concept_id)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise ValueError("Invalid saved cursor") from exc


_HISTORY_PAGE = text("""
    with page as materialized (
        select concept_id, assigned_for
          from public.daily_assignments
         where user_id = :uid and completed_at is not null
           and (cast(:before as date) is null or assigned_for < :before)
         order by assigned_for desc limit :take
    )
    select c.slug as concept_slug, p.assigned_for as learned_on,
           c.title, t.name as topic_name,
           (select count(*) from public.concept_interactions ci
             where ci.concept_id = p.concept_id and ci.liked_at is not null
               and ci.user_id <> :uid)::int as like_count
      from page p join public.concepts c on c.id = p.concept_id
      join public.topics t on t.id = c.topic_id
     order by p.assigned_for desc
""")

_SAVED_PAGE = text("""
    with page as materialized (
        select concept_id, saved_at
          from public.concept_interactions
         where user_id = :uid and saved_at is not null
           and (cast(:before as timestamptz) is null
                or (saved_at, concept_id) < (:before, cast(:id as uuid)))
         order by saved_at desc, concept_id desc limit :take
    )
    select c.slug as concept_slug, c.title, t.name as topic_name, p.saved_at, p.concept_id,
           (select count(*) from public.concept_interactions ci
             where ci.concept_id = p.concept_id and ci.liked_at is not null
               and ci.user_id <> :uid)::int as like_count
      from page p join public.concepts c on c.id = p.concept_id
      join public.topics t on t.id = c.topic_id
     order by p.saved_at desc, p.concept_id desc
""")


async def history_page(
    db: AsyncSession, user_id: uuid.UUID, before: date | None, limit: int,
) -> HistoryPageOut:
    rows = (await db.execute(_HISTORY_PAGE, {
        "uid": user_id, "before": before, "take": limit + 1,
    })).mappings().all()
    items = [LearnedOut(**r) for r in rows[:limit]]
    return HistoryPageOut(
        items=items,
        next_cursor=items[-1].learned_on.isoformat() if len(rows) > limit else None,
    )


async def saved_page(
    db: AsyncSession, user_id: uuid.UUID, cursor: str | None, limit: int,
) -> SavedPageOut:
    before, concept_id = parse_saved_cursor(cursor)
    rows = (await db.execute(_SAVED_PAGE, {
        "uid": user_id, "before": before, "id": concept_id, "take": limit + 1,
    })).mappings().all()
    return SavedPageOut(
        items=[SavedConceptOut(**r) for r in rows[:limit]],
        next_cursor=(saved_cursor(rows[limit - 1]["saved_at"].isoformat(),
                                  str(rows[limit - 1]["concept_id"]))
                     if len(rows) > limit else None),
    )
