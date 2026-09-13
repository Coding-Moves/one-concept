import asyncio
import uuid
from datetime import date, timedelta

import pytest
from app.services.interactions import complete_today
from app.services.reviews import complete_review
from app.services.selection import get_or_create_daily
from app.services.state import load_state
from app.services.streaks import compute_streaks, local_today
from fastapi import HTTPException
from sqlalchemy import text

DAY = date(2030, 1, 10)


@pytest.fixture
async def exhausted(session, user):
    await session.execute(
        text("""insert into public.daily_assignments(user_id,concept_id,assigned_for,completed_at)
      select :u,id,cast(:day as date)-(row_number() over(order by id))::int,now()
      from public.concepts where status='published' """),
        {"u": user, "day": DAY},
    )
    await session.commit()
    return user


async def test_review_is_explicit_rotates_and_does_not_inflate_learning(
    session, exhausted
):
    uid = exhausted
    before = await compute_streaks(session, uid, DAY)
    result = await get_or_create_daily(session, uid, today=DAY, allow_review=True)
    assert result.status == "review" and result.completed_at is None
    assert (await compute_streaks(session, uid, DAY)) == before
    for _ in range(2):
        assert await complete_review(session, uid, result.review_id, today=DAY) == DAY
    after = await compute_streaks(session, uid, DAY)
    assert after.total_learned == before.total_learned
    assert after.total_reviews == 1 and after.current == before.current + 1
    assert (
        await get_or_create_daily(session, uid, today=DAY, allow_review=True)
    ).completed_at
    next_day = await get_or_create_daily(
        session, uid, today=DAY + timedelta(days=1), allow_review=True
    )
    assert next_day.concept.id != result.concept.id


async def test_two_devices_choose_and_complete_one_review(
    session, exhausted, sessionmaker_for_test
):
    async def select():
        async with sessionmaker_for_test() as other:
            return await get_or_create_daily(
                other, exhausted, today=DAY, allow_review=True
            )

    results = await asyncio.gather(*(select() for _ in range(6)))
    assert len({r.review_id for r in results}) == 1

    async def complete():
        async with sessionmaker_for_test() as other:
            await complete_review(other, exhausted, results[0].review_id, today=DAY)

    await asyncio.gather(*(complete() for _ in range(6)))
    assert (await compute_streaks(session, exhausted, DAY)).total_reviews == 1


async def test_arriving_content_and_legacy_client_cannot_replace_review(
    session, exhausted
):
    result = await get_or_create_daily(session, exhausted, today=DAY, allow_review=True)
    cid = await session.scalar(
        text("""insert into public.concepts(topic_id,slug,title,summary)
      select id,:slug,'Fresh lesson','Fresh body' from public.topics where is_active limit 1 returning id"""),
        {"slug": "arrival-" + uuid.uuid4().hex},
    )
    await session.commit()
    assert (
        await get_or_create_daily(session, exhausted, today=DAY)
    ).status == "exhausted"
    assert (
        await get_or_create_daily(session, exhausted, today=DAY, allow_review=True)
    ).review_id == result.review_id
    assert (
        await get_or_create_daily(
            session, exhausted, today=DAY + timedelta(days=1), allow_review=True
        )
    ).concept.id == cid
    await session.execute(text('delete from public.daily_assignments where user_id=:u and concept_id=:c'), {'u':exhausted,'c':cid})
    await session.execute(text('delete from public.concepts where id=:c'), {'c':cid})
    await session.commit()


async def test_grace_rejects_backdating_wrong_account_and_newer_activity(
    session, exhausted
):
    review = await get_or_create_daily(session, exhausted, today=DAY, allow_review=True)
    with pytest.raises(HTTPException):
        await complete_review(session, uuid.uuid4(), review.review_id, today=DAY)
    with pytest.raises(HTTPException):
        await complete_review(
            session, exhausted, review.review_id, today=DAY + timedelta(days=2)
        )
    assert (
        await complete_review(
            session, exhausted, review.review_id, today=DAY + timedelta(days=1)
        )
        == DAY
    )
    second = await get_or_create_daily(
        session, exhausted, today=DAY + timedelta(days=1), allow_review=True
    )
    await get_or_create_daily(
        session, exhausted, today=DAY + timedelta(days=2), allow_review=True
    )
    with pytest.raises(HTTPException):
        await complete_review(
            session, exhausted, second.review_id, today=DAY + timedelta(days=2)
        )
    with pytest.raises(HTTPException):
        await complete_today(session, exhausted, DAY)
    await session.rollback()


async def test_no_completed_history_has_honest_exhaustion(session, exhausted):
    await session.execute(
        text("update public.daily_assignments set completed_at=null where user_id=:u"),
        {"u": exhausted},
    )
    await session.commit()
    assert (
        await get_or_create_daily(session, exhausted, today=DAY, allow_review=True)
    ).status == "exhausted"


async def test_review_uses_profile_timezone_and_state_matches_streaks(
    session, exhausted
):
    await session.execute(
        text("update public.profiles set timezone='Pacific/Kiritimati' where id=:u"),
        {"u": exhausted},
    )
    await session.commit()
    day = await local_today(session, exhausted)
    review = await get_or_create_daily(session, exhausted, allow_review=True)
    assert review.assigned_for == day
    # Fixture history is in 2030; completion here remains constrained by the
    # latest assignment. Move old history into the past for the timezone check.
    await session.execute(
        text(
            "update public.daily_assignments set assigned_for=assigned_for-10000 where user_id=:u"
        ),
        {"u": exhausted},
    )
    await session.commit()
    await complete_review(session, exhausted, review.review_id)
    assert (await load_state(session, exhausted)).stats == await compute_streaks(
        session, exhausted
    )
