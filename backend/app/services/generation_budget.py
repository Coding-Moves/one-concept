"""Shared daily reservations, made in the caller's short database transaction.

The caller must COMMIT before contacting Gemini. A failed/uncertain provider
request still costs its reservation; refunding it could exceed the daily cap.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class GenerationBudgetExhausted(RuntimeError):
    """Normal stop condition: no more generation calls may start today."""


# Gemini RPD resets at midnight Pacific, including DST. Use the database clock
# for all workers and statement_timestamp rather than the transaction's start:
# a session may have read its work list before the day changed.
_RESERVE = text("""
    insert into public.generation_daily_usage (budget_day, calls_used)
    select (statement_timestamp() at time zone 'America/Los_Angeles')::date, 1
     where :cap > 0
    on conflict (budget_day) do update
       set calls_used = generation_daily_usage.calls_used + 1
     where generation_daily_usage.calls_used < :cap
    returning calls_used
""")


async def reserve_generation_call(session: AsyncSession, call_cap: int) -> None:
    """Atomically reserve one call; the caller commits or rolls back the claim.

    The UPSERT locks the shared day's row and checks the latest committed count,
    so concurrent processes cannot each spend the same final slot. Database
    errors propagate: generation must never proceed without a confirmed budget.
    """
    used = (await session.execute(_RESERVE, {"cap": call_cap})).scalar_one_or_none()
    if used is None:
        raise GenerationBudgetExhausted("daily generation call cap reached")


class GenerationBusy(RuntimeError):
    """All shared provider slots are in use; retry on a later worker run."""


async def check_generation_capacity(session: AsyncSession) -> None:
    """Call AFTER reserving quota and BEFORE committing a durable work claim.

    The day's quota row lock serializes this count with all other claimers.
    Uncommitted claims do not reach a provider. Denial rolls back both the claim
    and its reservation; finished work immediately releases its counted slot.
    """
    from app.config import get_settings

    await session.execute(text("select pg_advisory_xact_lock(195,3)"))
    count = await session.scalar(
        text("""select
      (select count(*) from public.concept_backlog where status='generating'
        and claimed_at>=now()-interval '30 minutes') +
      (select count(*) from public.concept_revisions where status='generating'
        and created_at>=now()-interval '30 minutes')""")
    )
    if count > get_settings().generation_max_concurrent:
        raise GenerationBusy("shared generation concurrency limit reached")
