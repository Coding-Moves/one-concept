"""The Edge request budget is shared and atomic in PostgreSQL."""

import asyncio
from math import ceil
from time import monotonic

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_request_budget_separates_reads_and_writes(session, user):
    call = text("select public.edge_api_request_retry_after(:uid,:method,2,1)")
    args = {"uid": user, "method": "GET"}
    assert await session.scalar(call, args) == 0
    assert await session.scalar(call, args) == 0
    assert 1 <= await session.scalar(call, args) <= 30
    assert await session.scalar(call, {**args, "method": "POST"}) == 0
    assert 1 <= await session.scalar(call, {**args, "method": "POST"}) <= 60
    await session.execute(text("""update public.edge_api_request_buckets
      set updated_at = now() - interval '60 seconds'
      where user_id=:uid and kind='read'"""), {"uid": user})
    assert await session.scalar(call, args) == 0


@pytest.mark.asyncio
async def test_request_budget_is_service_only(session, user):
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_request_retry_after(uuid,text,integer,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_request_retry_after(uuid,text,integer,integer)', 'EXECUTE'),
      has_table_privilege('authenticated','public.edge_api_request_buckets','SELECT'),
      has_table_privilege('service_role','public.edge_api_request_buckets','UPDATE')"""))).one()
    assert rights == (False, True, False, True)
    try:
        await session.execute(text("set local role service_role"))
        assert await session.scalar(text("""select public.edge_api_request_retry_after(
          :uid,'GET',120,60)"""), {"uid": user}) == 0
    finally:
        await session.execute(text("reset role"))


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_account_budget(sessionmaker_for_test, user):
    gate = asyncio.Semaphore(10)
    query = text("select public.edge_api_request_retry_after(:uid,'GET',120,60)")

    async def attempt() -> int:
        async with gate, sessionmaker_for_test() as session:
            retry = await session.scalar(query, {"uid": user})
            await session.commit()
            return retry

    started = monotonic()
    retries = await asyncio.gather(*(attempt() for _ in range(500)))
    admitted = retries.count(0)
    assert 120 <= admitted <= 120 + ceil((monotonic() - started) * 2) + 1
    assert all(value == 0 or value >= 1 for value in retries)
