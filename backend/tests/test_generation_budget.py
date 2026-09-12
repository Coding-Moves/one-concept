"""A real PostgreSQL ledger must serialize competing workers and survive reruns."""

import asyncio
from datetime import date, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services import generation_budget as budget
from app.services.generation_budget import GenerationBudgetExhausted, reserve_generation_call

pytestmark = pytest.mark.usefixtures("empty_generation_budget")


async def usage(session):
    return (await session.execute(text(
        "select budget_day, calls_used from public.generation_daily_usage order by budget_day"
    ))).all()


async def test_concurrent_sessions_cannot_spend_the_same_slots(sessionmaker_for_test, session):
    async def reserve():
        async with sessionmaker_for_test() as worker:
            try:
                await reserve_generation_call(worker, 3)
                await worker.commit()
                return True
            except GenerationBudgetExhausted:
                await worker.rollback()
                return False

    results = await asyncio.gather(*(reserve() for _ in range(20)))
    assert sum(results) == 3
    assert [row.calls_used for row in await usage(session)] == [3]
    # A later worker with a fresh session sees the spent budget too.
    assert await reserve() is False


async def test_zero_cap_and_rollback_do_not_spend_budget(session):
    with pytest.raises(GenerationBudgetExhausted):
        await reserve_generation_call(session, 0)
    await session.rollback()
    assert await usage(session) == []
    await reserve_generation_call(session, 1)
    await session.rollback()
    assert await usage(session) == []
    await reserve_generation_call(session, 1)
    await session.commit()
    assert [row.calls_used for row in await usage(session)] == [1]


@pytest.mark.parametrize("before, after, first_day, second_day", [
    ("2026-01-12T07:59:59+00:00", "2026-01-12T08:00:00+00:00", date(2026, 1, 11), date(2026, 1, 12)),
    ("2026-07-12T06:59:59+00:00", "2026-07-12T07:00:00+00:00", date(2026, 7, 11), date(2026, 7, 12)),
])
async def test_budget_resets_at_pacific_midnight_in_winter_and_summer(
    session, monkeypatch, before, after, first_day, second_day,
):
    # Replace only the database clock, retaining the production timezone/UPSERT.
    query = text(str(budget._RESERVE).replace("statement_timestamp()", "cast(:now as timestamptz)"))
    for now in [before, before, after]:
        monkeypatch.setattr(budget, "_RESERVE", query.bindparams(now=datetime.fromisoformat(now)))
        await reserve_generation_call(session, 2)
        await session.commit()
    assert await usage(session) == [(first_day, 2), (second_day, 1)]


async def test_lowering_limit_does_not_erase_previous_usage(session):
    for _ in range(3):
        await reserve_generation_call(session, 3)
        await session.commit()
    with pytest.raises(GenerationBudgetExhausted):
        await reserve_generation_call(session, 2)
    await session.rollback()
    assert [row.calls_used for row in await usage(session)] == [3]
    await reserve_generation_call(session, 4)
    await session.commit()
    assert [row.calls_used for row in await usage(session)] == [4]


async def test_mobile_role_cannot_read_or_forge_usage(session):
    await reserve_generation_call(session, 2)
    # Simulate Supabase's broad public-schema grants; RLS must still deny access.
    await session.execute(text("grant select, insert, update, delete on public.generation_daily_usage to authenticated"))
    await session.commit()
    await session.execute(text("set local role authenticated"))
    assert await usage(session) == []
    with pytest.raises(DBAPIError, match="row-level security"):
        await session.execute(text("insert into public.generation_daily_usage values ('2000-01-01', 0)"))
    await session.rollback()
    assert [row.calls_used for row in await usage(session)] == [1]
