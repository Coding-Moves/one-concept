"""Daily Edge selection keeps the existing learner's unfinished lesson and subject boundary."""

import asyncio
import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)
DAILY = text("select public.edge_api_daily(:uid, 10, 60, 90, :day)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_daily_requires_active_follow_and_never_chooses_other_subjects(session, user):
    await session.execute(text("delete from public.user_topics where user_id = :uid"), {"uid": user})
    await session.commit()
    missing = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    assert missing == {
        "assigned_for": DAY.isoformat(), "reason": "personalization_required",
        "detail": "Follow at least one topic to receive a daily concept.",
    }
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid"), {"uid": user}) == 0

    topic = (await session.execute(text("select id,slug from public.topics where slug='software-engineering'"))).one()
    await session.execute(text("insert into public.user_topics(user_id,topic_id) values (:uid,:tid)"), {"uid": user, "tid": topic.id})
    await session.commit()
    selected = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    assert selected["concept"]["topic_slug"] == topic.slug
    assert selected["outside_followed_topics"] is False
    assert selected["learned"] is False


@pytest.mark.asyncio
async def test_daily_repeats_exact_unfinished_assignment_until_completion(session, user):
    first = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    await session.commit()
    same_day = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    assert same_day == first
    next_day = _json(await session.scalar(DAILY, {"uid": user, "day": date(2026, 10, 16)}))
    assert next_day["concept"]["id"] == first["concept"]["id"]
    assert next_day["assigned_at"] == first["assigned_at"]
    assert next_day["assigned_for"] == "2026-10-16"
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid"), {"uid": user}) == 1

    await session.execute(text("update public.daily_assignments set completed_at=now() where user_id=:uid"), {"uid": user})
    await session.commit()
    following = _json(await session.scalar(DAILY, {"uid": user, "day": date(2026, 10, 17)}))
    assert following["concept"]["id"] != first["concept"]["id"]


@pytest.mark.asyncio
async def test_daily_respects_completed_or_retired_daily_slots(session, user):
    first = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    await session.commit()
    await session.execute(text("update public.concepts set status='draft' where id=:cid"), {"cid": uuid.UUID(first["concept"]["id"])})
    await session.commit()
    unavailable = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    assert unavailable["reason"] == "catalog_exhausted"
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid and assigned_for=:day"), {"uid": user, "day": DAY}) == 1
    await session.execute(text("update public.concepts set status='published' where id=:cid"), {"cid": uuid.UUID(first["concept"]["id"])})
    await session.commit()


@pytest.mark.asyncio
async def test_daily_waits_for_new_followed_content_when_subject_is_exhausted(session, user):
    topic = (await session.execute(text("select id from public.topics where slug='software-engineering'"))).scalar_one()
    await session.execute(text("delete from public.user_topics where user_id = :uid"), {"uid": user})
    await session.execute(text("insert into public.user_topics(user_id,topic_id) values (:uid,:tid)"), {"uid": user, "tid": topic})
    concepts = (await session.execute(text("""
        select c.id from public.concepts c
        join public.subtopics s on s.id=c.subtopic_id and s.is_active
        where c.topic_id=:tid and c.status='published' order by c.id
    """), {"tid": topic})).scalars().all()
    assert concepts
    for offset, concept_id in enumerate(concepts):
        await session.execute(text("""
            insert into public.daily_assignments(user_id,concept_id,assigned_for,completed_at)
            values (:uid,:cid,:day,now())
        """), {"uid": user, "cid": concept_id, "day": date(2026, 1, 1) + timedelta(days=offset)})
    await session.commit()
    unavailable = _json(await session.scalar(DAILY, {"uid": user, "day": DAY}))
    assert unavailable["reason"] == "catalog_exhausted"
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid"), {"uid": user}) == len(concepts)


@pytest.mark.asyncio
async def test_two_devices_receive_one_daily_assignment(session, sessionmaker_for_test, user):
    async def fetch():
        async with sessionmaker_for_test() as other:
            result = _json(await other.scalar(DAILY, {"uid": user, "day": DAY}))
            await other.commit()
            return result

    first, second = await asyncio.gather(fetch(), fetch())
    assert first == second
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid and assigned_for=:day"), {"uid": user, "day": DAY}) == 1


@pytest.mark.asyncio
async def test_daily_uses_profile_timezone_when_edge_supplies_no_date(session, user):
    await session.execute(text("update public.profiles set timezone='Pacific/Kiritimati' where id=:uid"), {"uid": user})
    await session.commit()
    expected = await session.scalar(text("select (now() at time zone timezone)::date from public.profiles where id=:uid"), {"uid": user})
    actual = _json(await session.scalar(text("select public.edge_api_daily(:uid)"), {"uid": user}))
    assert actual["assigned_for"] == expected.isoformat()


@pytest.mark.asyncio
async def test_daily_rpc_is_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated', 'public.edge_api_daily(uuid,integer,integer,integer,date)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_daily_payload(uuid,date)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_signal_supply(uuid,uuid,integer,integer,integer)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_daily(uuid,integer,integer,integer,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, False, False, True)
