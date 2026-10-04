"""Future curated refill has a durable allowance separate from other Gemini work."""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from app.services.future_refill_budget import (
    FutureRefillBudgetExhausted,
    reserve_future_refill_call,
)


@pytest.fixture(autouse=True)
async def empty_future_refill_budget(session):
    await session.execute(text("delete from public.future_refill_topic_daily_usage"))
    await session.execute(text("delete from public.future_refill_daily_usage"))
    await session.commit()


async def _topic(session):
    return await session.scalar(
        text("insert into public.topics(slug,name) values (:slug,'Refill test') returning id"),
        {"slug": f"refill-{uuid.uuid4().hex}"},
    )


async def test_topic_and_global_allowances_are_transactional(session, sessionmaker_for_test):
    first, second = await _topic(session), await _topic(session)
    await session.commit()

    async def reserve(topic):
        async with sessionmaker_for_test() as worker:
            try:
                await reserve_future_refill_call(
                    worker, topic, global_cap=2, topic_cap=1
                )
                await worker.commit()
                return True
            except FutureRefillBudgetExhausted:
                await worker.rollback()
                return False

    results = await asyncio.gather(reserve(first), reserve(first), reserve(second))
    assert sum(results) == 2
    assert await session.scalar(
        text("select calls_used from future_refill_daily_usage")
    ) == 2
    rows = (await session.execute(text(
        "select calls_used from future_refill_topic_daily_usage order by calls_used"
    ))).scalars().all()
    assert rows == [1, 1]


async def test_topic_denial_does_not_burn_global_allowance(session):
    topic = await _topic(session)
    await reserve_future_refill_call(session, topic, global_cap=5, topic_cap=1)
    await session.commit()
    with pytest.raises(FutureRefillBudgetExhausted, match="topic"):
        await reserve_future_refill_call(session, topic, global_cap=5, topic_cap=1)
    await session.rollback()
    assert await session.scalar(
        text("select calls_used from future_refill_daily_usage")
    ) == 1
