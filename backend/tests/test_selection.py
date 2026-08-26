"""Daily selection behaviour, against a real PostgreSQL with the real schema."""

import asyncio
from datetime import date, timedelta

from sqlalchemy import text

from app.services.selection import get_or_create_daily

DAY = date(2026, 9, 1)


async def _followed_topic_ids(session, user_id):
    rows = await session.execute(
        text("select topic_id from public.user_topics where user_id = :u"), {"u": user_id}
    )
    return [r[0] for r in rows]


async def test_first_call_creates_an_assignment(session, user):
    result = await get_or_create_daily(session, user, today=DAY)
    assert result.status == "ok"
    assert result.concept is not None
    assert result.assigned_for == DAY
    assert result.completed_at is None


async def test_same_day_is_idempotent(session, user):
    first = await get_or_create_daily(session, user, today=DAY)
    second = await get_or_create_daily(session, user, today=DAY)

    assert first.concept.id == second.concept.id
    count = await session.scalar(
        text("select count(*) from public.daily_assignments where user_id = :u"),
        {"u": user},
    )
    assert count == 1, "a repeat call must not create a second assignment"


async def test_never_repeats_and_reports_exhaustion(session, user):
    """Twenty concepts means twenty distinct days, then an honest refusal."""
    seen = []
    for offset in range(20):
        result = await get_or_create_daily(session, user, today=DAY + timedelta(days=offset))
        assert result.status == "ok", f"day {offset} unexpectedly exhausted"
        seen.append(result.concept.id)

    assert len(set(seen)) == 20, "the same concept was assigned twice"

    beyond = await get_or_create_daily(session, user, today=DAY + timedelta(days=20))
    assert beyond.status == "exhausted"
    assert beyond.concept is None


async def test_only_draws_from_followed_topics(session, user):
    keep = (
        await session.execute(
            text("select id from public.topics where slug = 'mathematics'")
        )
    ).scalar_one()
    await session.execute(
        text("delete from public.user_topics where user_id = :u and topic_id <> :t"),
        {"u": user, "t": keep},
    )
    await session.commit()

    for offset in range(4):
        result = await get_or_create_daily(session, user, today=DAY + timedelta(days=offset))
        assert result.concept.topic_slug == "mathematics"
        assert result.outside_followed_topics is False


async def test_widens_beyond_followed_topics_when_pool_is_dry(session, user):
    keep = (
        await session.execute(
            text("select id from public.topics where slug = 'mathematics'")
        )
    ).scalar_one()
    await session.execute(
        text("delete from public.user_topics where user_id = :u and topic_id <> :t"),
        {"u": user, "t": keep},
    )
    await session.commit()

    for offset in range(4):
        await get_or_create_daily(session, user, today=DAY + timedelta(days=offset))

    # The followed topic is spent; rather than repeat, widen and say so.
    result = await get_or_create_daily(session, user, today=DAY + timedelta(days=4))
    assert result.status == "ok"
    assert result.concept.topic_slug != "mathematics"
    assert result.outside_followed_topics is True


async def test_topics_rotate_before_repeating(session, user):
    """Following five topics should give five different topics in five days."""
    topics = []
    for offset in range(5):
        result = await get_or_create_daily(session, user, today=DAY + timedelta(days=offset))
        topics.append(result.concept.topic_slug)
    assert len(set(topics)) == 5, f"expected five distinct topics, got {topics}"


async def test_concurrent_devices_get_the_same_concept(sessionmaker_for_test, user):
    """Two devices opening the app at once must not create two assignments."""

    async def call():
        async with sessionmaker_for_test() as s:
            return await get_or_create_daily(s, user, today=DAY)

    first, second = await asyncio.gather(call(), call())

    assert first.status == "ok" and second.status == "ok"
    assert first.concept.id == second.concept.id

    async with sessionmaker_for_test() as s:
        count = await s.scalar(
            text("select count(*) from public.daily_assignments where user_id = :u"),
            {"u": user},
        )
    assert count == 1, "the race created more than one assignment"


async def test_completion_is_reflected(session, user):
    result = await get_or_create_daily(session, user, today=DAY)
    await session.execute(
        text("update public.daily_assignments set completed_at = now() where user_id = :u"),
        {"u": user},
    )
    await session.commit()

    again = await get_or_create_daily(session, user, today=DAY)
    assert again.concept.id == result.concept.id
    assert again.completed_at is not None
