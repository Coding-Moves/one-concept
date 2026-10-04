"""Durable Pacific-day allowance for future curated-card refill.

This ledger is deliberately separate from editorial corrections and legacy-card
batch enrichment. A reservation happens in the same short transaction as a
backlog claim, then remains spent if a provider request fails or a worker dies.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class FutureRefillBudgetExhausted(RuntimeError):
    """A bounded future-refill allowance cannot admit another provider call."""

    def __init__(self, scope: str):
        self.scope = scope
        super().__init__(f"future refill {scope} allowance reached")


_GLOBAL_RESERVE = text("""
    insert into public.future_refill_daily_usage (budget_day, calls_used)
    select (statement_timestamp() at time zone 'America/Los_Angeles')::date, 1
     where :cap > 0
    on conflict (budget_day) do update
       set calls_used = future_refill_daily_usage.calls_used + 1
     where future_refill_daily_usage.calls_used < :cap
    returning calls_used
""")

_TOPIC_RESERVE = text("""
    insert into public.future_refill_topic_daily_usage (budget_day, topic_id, calls_used)
    select (statement_timestamp() at time zone 'America/Los_Angeles')::date, :topic_id, 1
     where :cap > 0
    on conflict (budget_day, topic_id) do update
       set calls_used = future_refill_topic_daily_usage.calls_used + 1
     where future_refill_topic_daily_usage.calls_used < :cap
    returning calls_used
""")


async def reserve_future_refill_call(
    session: AsyncSession,
    topic_id: uuid.UUID,
    *,
    global_cap: int,
    topic_cap: int,
) -> None:
    """Reserve one global and one topic slot atomically with the caller claim.

    Callers must roll back on ``FutureRefillBudgetExhausted``. That rollback
    removes a provisional global reservation when the topic is already full.
    """
    global_used = (
        await session.execute(_GLOBAL_RESERVE, {"cap": global_cap})
    ).scalar_one_or_none()
    if global_used is None:
        raise FutureRefillBudgetExhausted("global")
    topic_used = (
        await session.execute(
            _TOPIC_RESERVE, {"topic_id": topic_id, "cap": topic_cap}
        )
    ).scalar_one_or_none()
    if topic_used is None:
        raise FutureRefillBudgetExhausted("topic")
