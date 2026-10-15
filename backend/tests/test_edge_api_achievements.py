"""The Edge badge routes only read and acknowledge server-issued account facts."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_achievement_collection_reconciles_facts_and_reports_progress(session, user):
    concept = await session.scalar(text("select id from public.concepts where status='published' limit 1"))
    await session.execute(text("""
        insert into public.daily_assignments(user_id, concept_id, assigned_for, completed_at)
        values (:uid, :cid, :day, now())
    """), {"uid": user, "cid": concept, "day": DAY})
    await session.execute(text("""
        insert into public.user_concept_completions(user_id, concept_id, completed_at)
        values (:uid, :cid, now())
    """), {"uid": user, "cid": concept})
    await session.commit()

    result = _json(await session.scalar(text("select public.edge_api_achievements(:uid)"), {"uid": user}))
    assert result["current_streak"] >= 0
    assert result["longest_streak"] >= 1
    assert result["items"]
    assert all(set(item) == {
        "code", "metric", "threshold", "name", "description", "artwork_key",
        "category", "requirement", "show_progress", "progress", "earned_on",
        "source", "seen_at",
    } for item in result["items"])
    awarded = [item for item in result["items"] if item["metric"] == "completed_concepts"
               and item["threshold"] == 1]
    assert len(awarded) == 1
    assert awarded[0]["source"] == "history"
    assert awarded[0]["progress"] == 1
    again = _json(await session.scalar(text("select public.edge_api_achievements(:uid)"), {"uid": user}))
    assert again == result


@pytest.mark.asyncio
async def test_seen_only_updates_owned_awards_and_is_idempotent(session, user):
    other = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": other, "email": f"{other}@example.invalid"})
    code = await session.scalar(text("select code from public.achievement_definitions limit 1"))
    await session.execute(text("""
        insert into public.user_achievements(user_id, achievement_code, earned_on, source)
        values (:owner, :code, :day, 'history'), (:other, :code, :day, 'history')
    """), {"owner": user, "other": other, "code": code, "day": DAY})
    await session.commit()

    call = text("select public.edge_api_achievements_seen(:uid, :codes)")
    await session.execute(call, {"uid": user, "codes": [code, "unknown"]})
    first = await session.scalar(text("""
        select seen_at from public.user_achievements
        where user_id = :uid and achievement_code = :code
    """), {"uid": user, "code": code})
    assert first is not None
    await session.execute(call, {"uid": user, "codes": [code]})
    assert await session.scalar(text("""
        select seen_at from public.user_achievements
        where user_id = :uid and achievement_code = :code
    """), {"uid": user, "code": code}) == first
    assert await session.scalar(text("""
        select seen_at from public.user_achievements
        where user_id = :uid and achievement_code = :code
    """), {"uid": other, "code": code}) is None


@pytest.mark.asyncio
async def test_achievement_rpcs_are_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated', 'public.edge_api_achievements(uuid)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_achievements_seen(uuid,text[])', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_achievements(uuid)', 'EXECUTE')
    """))).one()
    assert permissions == (False, False, True)
