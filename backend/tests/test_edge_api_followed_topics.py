"""Follow replacement keeps user scope and does not create a daily assignment."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)
SET_TOPICS = text("select public.edge_api_set_topics(:uid, :slugs, :compact, :day)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_topic_replacement_is_idempotent_and_does_not_select_daily(session, user):
    args = {"uid": user, "slugs": ["software-engineering", "software-engineering"],
            "compact": True, "day": DAY}
    first = _json(await session.scalar(SET_TOPICS, args))
    assert first["followed_topics"] == ["software-engineering"]
    assert first["today"] == DAY.isoformat()
    assert first["daily"] is first["review"] is None
    assert first["daily_availability"] == "available"
    assert first["learned_before_window"] == {}
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid"),
                                {"uid": user}) == 0
    assert _json(await session.scalar(SET_TOPICS, args)) == first
    assert await session.scalar(text("select count(*) from public.user_topics where user_id=:uid"),
                                {"uid": user}) == 1


@pytest.mark.asyncio
async def test_unknown_topic_leaves_follows_unchanged_and_empty_list_removes_all(session, user):
    invalid = _json(await session.scalar(SET_TOPICS, {
        "uid": user, "slugs": ["software-engineering", "not-a-topic"],
        "compact": False, "day": DAY,
    }))
    assert invalid == {"error": "unknown_topics", "topics": ["not-a-topic"]}
    count = await session.scalar(text("select count(*) from public.user_topics where user_id=:uid"),
                                 {"uid": user})
    assert count > 1
    empty = _json(await session.scalar(SET_TOPICS, {
        "uid": user, "slugs": [], "compact": False, "day": DAY,
    }))
    assert empty["followed_topics"] == []
    assert empty["learned_before_window"] is None
    assert await session.scalar(text("select count(*) from public.user_topics where user_id=:uid"),
                                {"uid": user}) == 0


@pytest.mark.asyncio
async def test_topic_rpc_is_service_only_and_requires_a_profile(session, user):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated',
            'public.edge_api_set_topics(uuid,text[],boolean,date)', 'EXECUTE'),
          has_function_privilege('service_role',
            'public.edge_api_set_topics(uuid,text[],boolean,date)', 'EXECUTE'),
          has_function_privilege('authenticated',
            'public.edge_api_profile_snapshot(uuid,boolean,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, True, False)
    assert await session.scalar(SET_TOPICS, {
        "uid": uuid.uuid4(), "slugs": [], "compact": True, "day": DAY,
    }) is None
