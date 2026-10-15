"""The Edge completion RPC owns its user's accepted learning facts."""

import asyncio
import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)
CALL = text("select public.edge_api_complete_daily(:uid, :day)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_completion_requires_a_recent_assignment_and_cannot_cross_accounts(session, user):
    assert await session.scalar(CALL, {"uid": user, "day": DAY}) is None
    concept = await session.scalar(text("select id from public.concepts where status='published' limit 1"))
    await session.execute(text("""
        insert into public.daily_assignments(user_id,concept_id,assigned_for)
        values (:uid,:cid,:day)
    """), {"uid": user, "cid": concept, "day": DAY})
    await session.commit()
    assert await session.scalar(CALL, {"uid": uuid.uuid4(), "day": DAY}) is None
    assert await session.scalar(text("select completed_at is null from public.daily_assignments where user_id=:uid"), {"uid": user}) is True


@pytest.mark.asyncio
async def test_completion_is_idempotent_and_keeps_one_day_grace(session, user):
    concept = await session.scalar(text("select id from public.concepts where status='published' limit 1"))
    await session.execute(text("""
        insert into public.daily_assignments(user_id,concept_id,assigned_for)
        values (:uid,:cid,:day)
    """), {"uid": user, "cid": concept, "day": DAY})
    await session.commit()
    first = _json(await session.scalar(CALL, {"uid": user, "day": DAY + timedelta(days=1)}))
    assert first["completed"] is True
    assert first["assigned_for"] == DAY.isoformat()
    assert first["stats"]["total_learned"] == 1
    timestamp = await session.scalar(text("select completed_at from public.daily_assignments where user_id=:uid"), {"uid": user})
    await session.commit()
    repeated = _json(await session.scalar(CALL, {"uid": user, "day": DAY + timedelta(days=1)}))
    assert repeated["assigned_for"] == first["assigned_for"]
    assert repeated["stats"] == first["stats"]
    assert repeated["subtopic_completion"] is None
    assert await session.scalar(text("select completed_at from public.daily_assignments where user_id=:uid"), {"uid": user}) == timestamp
    assert await session.scalar(text("select count(*) from public.user_concept_completions where user_id=:uid"), {"uid": user}) == 1


@pytest.mark.asyncio
async def test_completion_records_subtopic_boundary_and_awards_once(session, user):
    concepts = (await session.execute(text("""
        select c.id from public.concepts c join public.subtopics s on s.id=c.subtopic_id
        where s.slug='probability' and c.status='published' order by c.id
    """))).scalars().all()
    assert len(concepts) >= 3
    final = None
    for offset, concept in enumerate(concepts):
        day = DAY + timedelta(days=offset)
        await session.execute(text("""
            insert into public.daily_assignments(user_id,concept_id,assigned_for)
            values (:uid,:cid,:day)
        """), {"uid": user, "cid": concept, "day": day})
        final = _json(await session.scalar(CALL, {"uid": user, "day": day}))
        await session.commit()
    assert final["subtopic_completion"]["subtopic_slug"] == "probability"
    assert final["stats"]["total_learned"] == len(concepts)
    replay = _json(await session.scalar(CALL, {"uid": user, "day": DAY + timedelta(days=len(concepts) - 1)}))
    assert replay["subtopic_completion"] is None
    assert await session.scalar(text("select count(*) from public.user_subtopic_completions where user_id=:uid"), {"uid": user}) == 1
    assert await session.scalar(text("select count(*) from public.user_achievements where user_id=:uid"), {"uid": user}) > 0


@pytest.mark.asyncio
async def test_concurrent_completion_writes_one_learning_record(session, sessionmaker_for_test, user):
    concept = await session.scalar(text("select id from public.concepts where status='published' limit 1"))
    await session.execute(text("""
        insert into public.daily_assignments(user_id,concept_id,assigned_for)
        values (:uid,:cid,:day)
    """), {"uid": user, "cid": concept, "day": DAY})
    await session.commit()

    async def complete():
        async with sessionmaker_for_test() as other:
            result = _json(await other.scalar(CALL, {"uid": user, "day": DAY}))
            await other.commit()
            return result

    first, second = await asyncio.gather(complete(), complete())
    assert first["assigned_for"] == second["assigned_for"]
    assert await session.scalar(text("select count(*) from public.user_concept_completions where user_id=:uid"), {"uid": user}) == 1


@pytest.mark.asyncio
async def test_completion_rpcs_are_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated', 'public.edge_api_complete_daily(uuid,date)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_record_subtopic_completion(uuid,uuid)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_award_eligible(uuid)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_complete_daily(uuid,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, False, False, True)
