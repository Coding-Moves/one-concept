"""Supply must follow reader demand, even after a catalog has reached its floor."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.config import get_settings
from app.services import pool, prefetch, selection
from app.services.generation import GeneratedConcept
from sqlalchemy import text


@pytest.fixture
async def full_topic(session, user):
    slug = "supply-" + uuid.uuid4().hex
    tid = await session.scalar(
        text(
            "insert into public.topics(slug,name) values (:s,'Supply fixture') returning id"
        ),
        {"s": slug},
    )
    for i in range(25):
        cid = await session.scalar(
            text("""insert into public.concepts(topic_id,slug,title,summary)
          values (:t,:s,'Fixture','Stored explanation') returning id"""),
            {"t": tid, "s": f"{slug}-{i}"},
        )
        await session.execute(
            text("""insert into public.daily_assignments(user_id,concept_id,assigned_for,completed_at)
          values (:u,:c,:d,now())"""),
            {"u": user, "c": cid, "d": datetime.now(UTC).date() - timedelta(days=i + 1)},
        )
    await session.execute(
        text("delete from public.user_topics where user_id=:u"), {"u": user}
    )
    await session.execute(
        text("insert into public.user_topics(user_id,topic_id) values (:u,:t)"),
        {"u": user, "t": tid},
    )
    for i in range(6):
        await session.execute(
            text("""insert into public.concept_backlog(topic_id,slug,title)
          values (:t,:s,'A new lesson')"""),
            {"t": tid, "s": f"{slug}-new-{i}"},
        )
    await session.commit()
    yield tid
    await session.rollback()
    await session.execute(
        text("update public.topics set is_active=false where id=:t"), {"t": tid}
    )
    await session.commit()


async def test_experienced_reader_refills_a_full_topic(
    empty_generation_budget,
    session,
    user,
    full_topic,
    sessionmaker_for_test,
    monkeypatch,
):
    settings = get_settings()
    monkeypatch.setattr(settings, "generation_enabled", True)
    monkeypatch.setattr(settings, "gemini_api_key", "fixture-key")
    monkeypatch.setattr(prefetch, "SessionLocal", sessionmaker_for_test)

    async def generate(**kwargs):
        return GeneratedConcept(
            summary="A reviewed-size explanation. " * 10,
            example="A concrete example of this concept.",
            model="fixture",
        )

    monkeypatch.setattr(pool, "generate_concept", generate)
    await selection.get_or_create_daily(session, user)
    if prefetch._tasks:
        await asyncio.gather(*list(prefetch._tasks))
    count = await session.scalar(
        text("select count(*) from public.concepts where topic_id=:t"),
        {"t": full_topic},
    )
    assert count > 25, (
        "A reader who exhausted 25 lessons must generate new drafts beyond the stocking floor"
    )


async def test_repeated_readers_and_publication_do_not_inflate_target(
    session, user, full_topic, sessionmaker_for_test
):
    from app.services.supply import signal_reader, target_for

    async def signal():
        async with sessionmaker_for_test() as other:
            await signal_reader(other, user, full_topic)

    await asyncio.gather(*(signal() for _ in range(12)))
    target = await target_for(session, full_topic)
    assert target == 25 + get_settings().content_reserve_per_topic
    await session.execute(
        text("""insert into public.concepts(topic_id,slug,title,summary)
      values (:t,:s,'New shared lesson','Published after demand')"""),
        {"t": full_topic, "s": uuid.uuid4().hex},
    )
    await session.commit()
    await signal_reader(session, user, full_topic)
    assert await target_for(session, full_topic) == target


async def test_capacity_claims_include_other_workers_in_flight(
    empty_generation_budget, session, full_topic, sessionmaker_for_test, monkeypatch
):
    called = 0
    entered = asyncio.Event()
    release = asyncio.Event()

    async def generate(**kwargs):
        nonlocal called
        called += 1
        entered.set()
        await release.wait()
        return GeneratedConcept(
            summary="An explanation. " * 20,
            example="A concrete example.",
            model="fixture",
        )

    monkeypatch.setattr(pool, "generate_concept", generate)

    async def run():
        async with sessionmaker_for_test() as other:
            return await pool.generate_one(
                other, "k", "m", full_topic, call_cap=100, supply_target=26
            )

    first = asyncio.create_task(run())
    await asyncio.wait_for(entered.wait(), 5)
    try:
        assert await asyncio.wait_for(run(), 5) is None
    finally:
        release.set()
    assert await first is not None
    assert called == 1


async def test_retirement_disables_new_selection_and_generation(
    empty_generation_budget, session, user, full_topic, monkeypatch
):
    await session.execute(
        text("update public.topics set is_active=false where id=:t"), {"t": full_topic}
    )
    await session.commit()

    async def unexpected(**kwargs):
        raise AssertionError("retired subject reached provider")

    monkeypatch.setattr(pool, "generate_concept", unexpected)
    assert (
        await pool.generate_one(
            session, "k", "m", full_topic, call_cap=100, supply_target=80
        )
        is None
    )
    result = await selection.get_or_create_daily(session, user)
    assert result.concept is None or not result.concept.topic_slug.startswith("supply-")
