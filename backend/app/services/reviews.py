"""Daily review selection and explicit, idempotent completion.

Selection runs under the same profile row lock as new daily assignments. Review
never inserts an assignment and can only use a previously completed lesson.
"""

import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_EXISTING = text("""select r.id as review_id,r.assigned_for,r.assigned_at,r.completed_at,
  c.id,c.slug,c.title,c.summary,c.example,c.content_version,
  t.slug as topic_slug,t.name as topic_name,
  (select count(*) from public.concept_interactions i where i.concept_id=c.id
    and i.liked_at is not null and i.user_id<>:uid)::int as like_count
  from public.daily_reviews r join public.concepts c on c.id=r.concept_id
  join public.topics t on t.id=c.topic_id where r.user_id=:uid and r.assigned_for=:today""")


async def existing_review(session: AsyncSession, user_id: uuid.UUID, today: date):
    from app.services.selection import _row_to_result

    row = (await session.execute(_EXISTING, {"uid": user_id, "today": today})).first()
    if row is None:
        return None
    result = _row_to_result(row, outside=False)
    result.status = "review"
    result.review_id = row.review_id
    return result


async def choose_review(session: AsyncSession, user_id: uuid.UUID, today: date):
    cid = await session.scalar(
        text("""select a.concept_id from public.daily_assignments a
      join public.concepts c on c.id=a.concept_id
      left join lateral (select max(r.assigned_for) as last_review from public.daily_reviews r
        where r.user_id=:uid and r.concept_id=a.concept_id) seen on true
      where a.user_id=:uid and a.completed_at is not null and c.status='published'
      order by seen.last_review asc nulls first,a.assigned_for,a.concept_id limit 1"""),
        {"uid": user_id},
    )
    if cid is None:
        return None
    await session.execute(
        text("""insert into public.daily_reviews(user_id,concept_id,assigned_for)
      values (:uid,:cid,:today) on conflict(user_id,assigned_for) do nothing"""),
        {"uid": user_id, "cid": cid, "today": today},
    )
    return await existing_review(session, user_id, today)


async def complete_review(
    session: AsyncSession,
    user_id: uuid.UUID,
    review_id: uuid.UUID,
    *,
    today: date | None = None,
) -> date:
    # Same lock/order as selection. A just-past-midnight tap may complete yesterday
    # only while no later activity has been assigned. No client date is accepted.
    server_today = await session.scalar(
        text(
            "select (now() at time zone timezone)::date from public.profiles where id=:uid for update"
        ),
        {"uid": user_id},
    )
    today = today or server_today
    row = (
        await session.execute(
            text("""update public.daily_reviews r
      set completed_at=coalesce(completed_at,now()) where r.id=:id and r.user_id=:uid
      and (r.completed_at is not null or (
        r.assigned_for in (cast(:today as date),cast(:today as date)-1)
        and not exists(select 1 from public.daily_assignments a where a.user_id=:uid and a.assigned_for>r.assigned_for)
        and not exists(select 1 from public.daily_reviews newer where newer.user_id=:uid and newer.assigned_for>r.assigned_for)))
      returning assigned_for"""),
            {"uid": user_id, "id": review_id, "today": today},
        )
    ).first()
    if row is None:
        await session.rollback()
        raise HTTPException(
            409, detail="Review is unavailable or its completion window has ended"
        )
    await session.commit()
    return row.assigned_for
