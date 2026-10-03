"""Real concurrent claims must respect human capacity and fence stale outputs."""

import asyncio

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.services import pool
from app.services.generation import GeneratedConcept
from tests import test_generation_limits

topic = test_generation_limits.topic
generator = test_generation_limits.generator
calls_used = test_generation_limits.calls_used

pytestmark = pytest.mark.usefixtures("empty_generation_budget")


async def test_parallel_claims_stop_at_review_capacity(
    topic, generator, session, monkeypatch, sessionmaker_for_test
):
    monkeypatch.setattr(get_settings(), "content_review_backlog_limit", 2)

    async def run():
        async with sessionmaker_for_test() as db:
            return await pool.generate_one(db, "fixture", "fixture", topic, call_cap=20)

    results = await asyncio.gather(*(run() for _ in range(8)))
    assert len([r for r in results if r]) == 2
    assert generator.await_count == await calls_used(session) == 2
    assert await run() is None
    assert await calls_used(session) == 2
    assert (
        await session.scalar(
            text(
                "select count(*) from concepts where topic_id=:t and status='published'"
            ),
            {"t": topic},
        )
        == 0
    )


async def test_expired_pool_claim_cannot_write_or_finish_newer_attempt(
    topic, generator, session, sessionmaker_for_test
):
    async def expired(**kwargs):
        assert not session.in_transaction()
        async with sessionmaker_for_test() as db:
            await db.execute(
                text(
                    "update concept_backlog set claimed_at=now()-interval '31 minutes' where topic_id=:t and status='generating'"
                ),
                {"t": topic},
            )
            await db.execute(
                text(
                    "update concept_backlog set status='failed' where topic_id=:t and status='pending'"
                ),
                {"t": topic},
            )
            await db.execute(pool._REAP_STALE, {"max_minutes": 30})
            await db.execute(pool._CLAIM, {"topic_id": topic})
            await db.commit()
        return GeneratedConcept(
            summary="Old result", example="Old example", model="fixture"
        )

    generator.side_effect = expired
    assert (
        await pool.generate_one(session, "fixture", "fixture", topic, call_cap=10)
        is None
    )
    assert (
        await session.scalar(
            text("select count(*) from concepts where topic_id=:t"), {"t": topic}
        )
        == 0
    )
    assert (
        await session.scalar(
            text(
                "select count(*) from concept_backlog where topic_id=:t and status='generating' and attempts=2"
            ),
            {"t": topic},
        )
        == 1
    )


async def test_full_review_queue_is_not_a_provider_failure(
    topic, generator, session, monkeypatch
):
    monkeypatch.setattr(get_settings(), "content_review_backlog_limit", 1)
    assert await pool.generate_one(session, "fixture", "fixture", topic, call_cap=20)
    result = await pool.top_up(
        session,
        api_key="fixture",
        model="fixture",
        enabled=True,
        minimum_per_topic=25,
        call_cap=20,
    )
    assert result.generated == result.failed == 0
    assert generator.await_count == 1
