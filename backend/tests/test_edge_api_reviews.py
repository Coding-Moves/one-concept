"""Review RPCs keep a single account's activity idempotent and server-dated."""

import asyncio
import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)
SELECT = text("select public.edge_api_choose_review(:uid, :day)")
COMPLETE = text("select public.edge_api_complete_review(:uid, :rid, :day)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


async def _learned_assignment(session, user, day):
    concept = await session.scalar(text("""
        select c.id from public.concepts c
        join public.topics t on t.id=c.topic_id and t.is_active
        join public.subtopics s on s.id=c.subtopic_id and s.is_active
        join public.user_topics ut on ut.topic_id=c.topic_id and ut.user_id=:uid
        where c.status='published' limit 1
    """), {"uid": user})
    assert concept is not None
    await session.execute(text("""
        insert into public.daily_assignments(user_id, concept_id, assigned_for, completed_at)
        values (:uid, :cid, :day, now())
    """), {"uid": user, "cid": concept, "day": day})
    await session.commit()
    return concept


@pytest.mark.asyncio
async def test_review_reuses_followed_learned_lesson_and_completes_once(session, user):
    concept = await _learned_assignment(session, user, DAY - timedelta(days=1))
    first = _json(await session.scalar(SELECT, {"uid": user, "day": DAY}))
    assert first["review_id"]
    assert first["assigned_for"] == DAY.isoformat()
    assert first["concept"]["id"] == str(concept)
    assert first["learned"] is False
    await session.commit()
    repeated = _json(await session.scalar(SELECT, {"uid": user, "day": DAY}))
    assert repeated == first
    done = _json(await session.scalar(COMPLETE, {
        "uid": user, "rid": first["review_id"], "day": DAY,
    }))
    assert done["completed"] is True
    assert done["assigned_for"] == DAY.isoformat()
    assert done["stats"]["total_reviews"] == 1
    assert done["subtopic_completion"] is None
    await session.commit()
    again = _json(await session.scalar(COMPLETE, {
        "uid": user, "rid": first["review_id"], "day": DAY + timedelta(days=2),
    }))
    assert again["stats"]["total_reviews"] == 1
    assert await session.scalar(text("select count(*) from public.daily_reviews where user_id=:uid"), {"uid": user}) == 1


@pytest.mark.asyncio
async def test_review_respects_followed_boundary_and_account_scope(session, user):
    concept = await _learned_assignment(session, user, DAY - timedelta(days=1))
    await session.execute(text("delete from public.user_topics where user_id=:uid"), {"uid": user})
    assert await session.scalar(SELECT, {"uid": user, "day": DAY}) is None
    await session.execute(text("""
        insert into public.user_topics(user_id, topic_id)
        select :uid, topic_id from public.concepts where id=:cid
    """), {"uid": user, "cid": concept})
    review = _json(await session.scalar(SELECT, {"uid": user, "day": DAY}))
    assert review is not None
    assert await session.scalar(COMPLETE, {
        "uid": uuid.uuid4(), "rid": review["review_id"], "day": DAY,
    }) is None
    assert await session.scalar(text("select completed_at from public.daily_reviews where id=:rid"),
                                {"rid": review["review_id"]}) is None


@pytest.mark.asyncio
async def test_review_expiry_and_newer_assignment_block_late_completion(session, user):
    await _learned_assignment(session, user, DAY - timedelta(days=1))
    review = _json(await session.scalar(SELECT, {"uid": user, "day": DAY}))
    assert await session.scalar(COMPLETE, {
        "uid": user, "rid": review["review_id"], "day": DAY + timedelta(days=2),
    }) is None
    assert await session.scalar(COMPLETE, {
        "uid": user, "rid": review["review_id"], "day": DAY + timedelta(days=1),
    }) is not None


@pytest.mark.asyncio
async def test_concurrent_review_selection_has_one_slot(session, sessionmaker_for_test, user):
    await _learned_assignment(session, user, DAY - timedelta(days=1))

    async def choose():
        async with sessionmaker_for_test() as other:
            result = _json(await other.scalar(SELECT, {"uid": user, "day": DAY}))
            await other.commit()
            return result

    first, second = await asyncio.gather(choose(), choose())
    assert first["review_id"] == second["review_id"]
    assert await session.scalar(text("select count(*) from public.daily_reviews where user_id=:uid"), {"uid": user}) == 1


@pytest.mark.asyncio
async def test_review_rpcs_are_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated', 'public.edge_api_review_payload(uuid,date)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_choose_review(uuid,date)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_complete_review(uuid,uuid,date)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_complete_review(uuid,uuid,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, False, False, True)
