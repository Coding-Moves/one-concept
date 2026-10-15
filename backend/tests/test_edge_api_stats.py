"""The Edge streak RPC matches the current service on real PostgreSQL."""

import json

import pytest
from sqlalchemy import text

from app.services.streaks import compute_streaks


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_edge_stats_use_profile_day_and_completed_reviews(session, user):
    await session.execute(
        text("update public.profiles set timezone='Pacific/Kiritimati' where id=:uid"),
        {"uid": user},
    )
    call = text("select public.edge_api_stats(:uid)")
    assert _json(await session.scalar(call, {"uid": user})) == {
        "current": 0, "longest": 0, "total_learned": 0, "total_reviews": 0,
    }
    concept_id = await session.scalar(text(
        "select id from public.concepts where status='published' limit 1"
    ))
    await session.execute(text("""
        insert into public.daily_assignments
        (user_id, concept_id, assigned_for, completed_at)
        select :uid, :cid, (now() at time zone timezone)::date - 1, now()
        from public.profiles where id=:uid
    """), {"uid": user, "cid": concept_id})
    await session.execute(text("""
        insert into public.daily_reviews
        (user_id, concept_id, assigned_for, completed_at)
        select :uid, :cid, (now() at time zone timezone)::date, now()
        from public.profiles where id=:uid
    """), {"uid": user, "cid": concept_id})
    await session.flush()
    expected = vars(await compute_streaks(session, user))
    candidate = _json(await session.scalar(call, {"uid": user}))
    assert candidate == expected == {
        "current": 2, "longest": 2, "total_learned": 1, "total_reviews": 1,
    }


@pytest.mark.asyncio
async def test_edge_stats_rpc_is_service_only(session):
    permissions = (
        await session.execute(text("""
            select
              has_function_privilege('authenticated', 'public.edge_api_stats(uuid)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.edge_api_stats(uuid)', 'EXECUTE')
        """))
    ).one()
    assert permissions == (False, True)
