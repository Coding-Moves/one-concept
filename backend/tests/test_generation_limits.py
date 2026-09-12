"""Shared call limits across real backlog transactions and mocked generation."""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services import generation_budget as budget, pool, prefetch
from app.services.generation import GeneratedConcept, GenerationError, RateLimitedError
from app.services.generation_budget import GenerationBudgetExhausted

pytestmark = pytest.mark.usefixtures("empty_generation_budget")


@pytest_asyncio.fixture
async def topic(session, monkeypatch):
    tid = uuid.uuid4()
    await session.execute(text("""
        insert into public.topics (id, slug, name, is_active)
        values (:id, :slug, 'Budget fixture', false)
    """), {"id": tid, "slug": f"budget-{tid}"})
    await session.execute(text("""
        insert into public.concept_backlog (topic_id, slug, title)
        select :id, :prefix || n, 'Fixture ' || n from generate_series(1, 20) n
    """), {"id": tid, "prefix": f"budget-{tid}-"})
    await session.commit()
    # Restrict only fixture selection; retain the real counts/claim/publish SQL.
    monkeypatch.setattr(pool, "_POOL_COUNTS", text(str(pool._POOL_COUNTS).replace(
        "where t.is_active", "where t.id = :tid"
    )).bindparams(tid=tid))
    yield tid
    await session.rollback()
    await session.execute(text("delete from public.concepts where topic_id = :id"), {"id": tid})
    await session.execute(text("delete from public.topics where id = :id"), {"id": tid})
    await session.commit()


@pytest.fixture
def generator(monkeypatch):
    mock = AsyncMock(return_value=GeneratedConcept(summary="Fixture summary", example="Fixture example", model="test"))
    monkeypatch.setattr(pool, "generate_concept", mock)
    return mock


async def calls_used(session):
    return await session.scalar(text("select coalesce(sum(calls_used), 0) from public.generation_daily_usage"))


async def top_up(session, cap):
    return await pool.top_up(session, api_key="test", model="test", enabled=True,
                             minimum_per_topic=25, call_cap=cap)


async def test_scheduled_runs_share_daily_limit(topic, generator, session):
    first = await top_up(session, 2)
    second = await top_up(session, 2)
    assert (first.generated, second.generated) == (2, 0)
    assert second.skipped_reason == "daily call cap reached"
    assert generator.await_count == await calls_used(session) == 2


async def test_quota_denial_rolls_back_claim_and_attempt(topic, generator, session):
    with pytest.raises(GenerationBudgetExhausted):
        await pool.generate_one(session, "test", "test", topic, call_cap=0)
    assert not session.in_transaction()
    assert await calls_used(session) == 0
    statuses = (await session.execute(text(
        "select distinct status, attempts, claimed_at from public.concept_backlog where topic_id = :id"
    ), {"id": topic})).all()
    assert statuses == [("pending", 0, None)]
    generator.assert_not_awaited()


async def test_no_backlog_does_not_spend_budget(topic, generator, session):
    await session.execute(text("delete from public.concept_backlog where topic_id = :id"), {"id": topic})
    await session.commit()
    assert await pool.generate_one(session, "test", "test", topic, call_cap=2) is None
    assert await calls_used(session) == 0
    generator.assert_not_awaited()


async def test_reservation_is_committed_before_provider_call(topic, generator, session, sessionmaker_for_test):
    async def generate(**kwargs):
        assert not session.in_transaction(), "no connection stays pinned during generation"
        async with sessionmaker_for_test() as observer:
            assert await calls_used(observer) == 1
        return GeneratedConcept(summary="Fixture", example="Fixture", model="test")
    generator.side_effect = generate
    assert await pool.generate_one(session, "test", "test", topic, call_cap=1)


@pytest.mark.parametrize("failure", [GenerationError("bad response"), RateLimitedError(), asyncio.CancelledError()])
async def test_failed_throttled_or_cancelled_calls_keep_their_reservation(topic, generator, session, failure):
    generator.side_effect = failure
    if type(failure) is GenerationError:
        assert await pool.generate_one(session, "test", "test", topic, call_cap=1) is None
    else:
        with pytest.raises(type(failure)):
            await pool.generate_one(session, "test", "test", topic, call_cap=1)
    with pytest.raises(GenerationBudgetExhausted):
        await pool.generate_one(session, "test", "test", topic, call_cap=1)
    assert generator.await_count == await calls_used(session) == 1
    attempts = await session.scalar(text(
        "select sum(attempts) from public.concept_backlog where topic_id = :id"
    ), {"id": topic})
    assert attempts == (0 if isinstance(failure, RateLimitedError) else 1)


async def test_parallel_generation_keeps_claims_and_budget_consistent(topic, generator, session, sessionmaker_for_test):
    async def generate():
        async with sessionmaker_for_test() as worker:
            try:
                return await pool.generate_one(worker, "test", "test", topic, call_cap=3)
            except GenerationBudgetExhausted:
                return None
    results = await asyncio.gather(*(generate() for _ in range(12)))
    assert len({result for result in results if result}) == 3
    assert generator.await_count == await calls_used(session) == 3
    attempts = await session.scalar(text(
        "select sum(attempts) from public.concept_backlog where topic_id = :id"
    ), {"id": topic})
    assert attempts == 3


async def test_budget_database_error_prevents_generation_and_releases_claim(topic, generator, session, monkeypatch):
    monkeypatch.setattr(budget, "_RESERVE", text("select 1 / 0"))
    with pytest.raises(DBAPIError):
        await pool.generate_one(session, "test", "test", topic, call_cap=2)
    assert not session.in_transaction()
    generator.assert_not_awaited()
    assert await calls_used(session) == 0
    assert await session.scalar(text(
        "select sum(attempts) from public.concept_backlog where topic_id = :id"
    ), {"id": topic}) == 0


async def test_failed_budget_commit_never_calls_provider(topic, generator, session, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", AsyncMock(side_effect=RuntimeError("commit failed")))
        with pytest.raises(RuntimeError, match="commit failed"):
            await pool.generate_one(session, "test", "test", topic, call_cap=2)
    generator.assert_not_awaited()
    assert await calls_used(session) == 0



def test_negative_daily_cap_is_rejected():
    from pydantic import ValidationError
    from app.config import Settings
    with pytest.raises(ValidationError, match="generation_daily_call_cap"):
        Settings(_env_file=None, database_url="postgresql://test:test@localhost/test",
                 supabase_url="http://test.invalid", supabase_jwks_url="http://test.invalid/jwks",
                 generation_daily_call_cap=-1)


@pytest.fixture
def prefetch_config(monkeypatch, sessionmaker_for_test):
    config = SimpleNamespace(generation_enabled=True, generation_on_demand=True,
                             gemini_api_key="test", gemini_model="test", generation_daily_call_cap=2)
    monkeypatch.setattr(prefetch, "get_settings", lambda: config)
    monkeypatch.setattr(prefetch, "SessionLocal", sessionmaker_for_test)
    return config


async def run_prefetch(topic):
    prefetch.request_prefetch(topic)
    await asyncio.gather(*list(prefetch._tasks))
    assert topic not in prefetch._inflight


async def test_prefetch_zero_cap_makes_no_provider_call(topic, generator, session, prefetch_config, caplog):
    prefetch_config.generation_daily_call_cap = 0
    with caplog.at_level("INFO"):
        await run_prefetch(topic)
    generator.assert_not_awaited()
    assert await calls_used(session) == 0
    assert "daily call cap reached" in caplog.text
    assert not any(record.levelname == "ERROR" for record in caplog.records)


@pytest.mark.parametrize("prefetch_first", [True, False])
async def test_scheduled_and_prefetch_share_remaining_budget(topic, generator, session, prefetch_config, prefetch_first):
    if prefetch_first:
        await run_prefetch(topic)
        assert (await top_up(session, 2)).generated == 0
    else:
        assert (await top_up(session, 2)).generated == 2
        await run_prefetch(topic)
    # Re-triggering a completed background job cannot restore its allowance.
    await run_prefetch(topic)
    assert generator.await_count == await calls_used(session) == 2


async def test_prefetch_and_worker_compete_for_the_same_last_slots(topic, generator, session, prefetch_config):
    await asyncio.gather(run_prefetch(topic), top_up(session, 2))
    assert generator.await_count == await calls_used(session) == 2


@pytest.mark.parametrize("disabled", ["generation_enabled", "generation_on_demand", "gemini_api_key"])
async def test_prefetch_preserves_generation_switches(topic, generator, session, prefetch_config, disabled):
    setattr(prefetch_config, disabled, "" if disabled == "gemini_api_key" else False)
    await run_prefetch(topic)
    generator.assert_not_awaited()
    assert await calls_used(session) == 0


async def test_prefetch_rate_limit_spends_quota_but_refunds_backlog_attempt(topic, generator, session, prefetch_config):
    generator.side_effect = RateLimitedError()
    await run_prefetch(topic)
    assert generator.await_count == await calls_used(session) == 1
    assert await session.scalar(text(
        "select sum(attempts) from public.concept_backlog where topic_id = :id"
    ), {"id": topic}) == 0
