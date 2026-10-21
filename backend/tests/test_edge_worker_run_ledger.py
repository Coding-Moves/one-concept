"""The scheduler handoff is fenced by one committed run per job."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_dispatch_requires_explicit_enable_and_one_use(session):
    tick = await session.scalar(text("select date_trunc('minute', clock_timestamp())"))
    run_id = await session.scalar(
        text("select public.edge_worker_enqueue_run('daily_reminders', :tick)"),
        {"tick": tick},
    )
    again = await session.scalar(
        text("select public.edge_worker_enqueue_run('daily_reminders', :tick)"),
        {"tick": tick},
    )
    assert again == run_id
    await session.commit()
    assert not await session.scalar(
        text("select public.edge_worker_start_run(:id, 'daily_reminders')"),
        {"id": run_id},
    )
    await session.execute(text("update public.edge_worker_jobs set enabled=true where name='daily_reminders'"))
    await session.commit()
    assert await session.scalar(
        text("select public.edge_worker_start_run(:id, 'daily_reminders')"),
        {"id": run_id},
    )
    await session.commit()
    assert not await session.scalar(
        text("select public.edge_worker_start_run(:id, 'daily_reminders')"),
        {"id": run_id},
    )
    assert await session.scalar(
        text("select public.edge_worker_finish_run(:id, true, cast(:result as jsonb))"),
        {"id": run_id, "result": '{"sent":1}'},
    )
    assert not await session.scalar(
        text("select public.edge_worker_finish_run(:id, true)"), {"id": run_id},
    )
    status = await session.scalar(
        text("select status from public.edge_worker_runs where id=:id"), {"id": run_id},
    )
    assert status == "succeeded"
    await session.execute(text("update public.edge_worker_jobs set enabled=false where name='daily_reminders'"))
    await session.execute(text("delete from public.edge_worker_runs where job='daily_reminders'"))
    await session.commit()


@pytest.mark.asyncio
async def test_overlapping_claims_and_expired_dispatch(sessionmaker_for_test):
    async with sessionmaker_for_test() as session:
        tick = await session.scalar(text("select date_trunc('minute', clock_timestamp())"))
        await session.execute(text("update public.edge_worker_jobs set enabled=true where name='weekly_quiz'"))
        first = await session.scalar(
            text("select public.edge_worker_enqueue_run('weekly_quiz', :tick)"), {"tick": tick},
        )
        second = await session.scalar(
            text("select public.edge_worker_enqueue_run('weekly_quiz', cast(:tick as timestamptz) + interval '1 second')"),
            {"tick": tick},
        )
        await session.commit()

    async def claim(run_id):
        async with sessionmaker_for_test() as session:
            won = await session.scalar(
                text("select public.edge_worker_start_run(:id, 'weekly_quiz')"),
                {"id": run_id},
            )
            await session.commit()
            return won

    winners = await asyncio.gather(claim(first), claim(second))
    assert winners.count(True) == 1
    winner = first if winners[0] else second
    loser = second if winners[0] else first

    async with sessionmaker_for_test() as session:
        # Simulate termination after a provider claim: no second run starts
        # while the durable lease is live.
        assert not await session.scalar(
            text("select public.edge_worker_start_run(:id, 'weekly_quiz')"),
            {"id": loser},
        )
        await session.execute(text("update public.edge_worker_runs set started_at=clock_timestamp()-interval '5 minutes' where id=:id"), {"id": winner})
        await session.execute(text("update public.edge_worker_jobs set lease_until=clock_timestamp()-interval '2 minutes' where name='weekly_quiz'"))
        assert await session.scalar(text("select public.edge_worker_expire_runs()")) >= 1
        assert not await session.scalar(
            text("select public.edge_worker_finish_run(:id, true)"), {"id": winner},
        )
        await session.execute(text("update public.edge_worker_jobs set enabled=false where name='weekly_quiz'"))
        await session.execute(text("delete from public.edge_worker_runs where job='weekly_quiz'"))
        await session.commit()


@pytest.mark.asyncio
async def test_worker_ledger_is_service_only(session):
    result = (await session.execute(text("""select
      has_table_privilege('authenticated','public.edge_worker_runs','SELECT'),
      has_table_privilege('service_role','public.edge_worker_runs','SELECT'),
      has_function_privilege('anon','public.edge_worker_start_run(uuid,text)','EXECUTE'),
      has_function_privilege('service_role','public.edge_worker_start_run(uuid,text)','EXECUTE')"""))).one()
    assert result == (False, True, False, True)


@pytest.mark.asyncio
async def test_reconcile_prunes_only_old_terminal_run_history(session):
    savepoint = await session.begin_nested()
    try:
        old_success, old_failure, recent_success, fresh_queue = (uuid4() for _ in range(4))
        await session.execute(text("""insert into public.edge_worker_runs
          (id,job,scheduled_for,status,queued_at,finished_at) values
          (:old_success,'prefetch',now()-interval '32 days','succeeded',
           now()-interval '32 days',now()-interval '32 days'),
          (:old_failure,'prefetch',now()-interval '31 days','failed',
           now()-interval '31 days',now()-interval '31 days'),
          (:recent_success,'prefetch',now()-interval '1 day','succeeded',
           now()-interval '1 day',now()-interval '1 day'),
          (:fresh_queue,'prefetch',now(),'queued',now(),null)"""),
          {"old_success": old_success, "old_failure": old_failure,
           "recent_success": recent_success, "fresh_queue": fresh_queue})
        assert await session.scalar(text("select public.edge_worker_expire_runs()")) == 0
        retained = set((await session.execute(text("""select id from public.edge_worker_runs
          where id in (:old_success,:old_failure,:recent_success,:fresh_queue)"""),
          {"old_success": old_success, "old_failure": old_failure,
           "recent_success": recent_success, "fresh_queue": fresh_queue})).scalars())
        assert retained == {recent_success, fresh_queue}
    finally:
        await savepoint.rollback()
