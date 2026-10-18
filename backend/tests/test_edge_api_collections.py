"""Compare paged Edge collection RPCs with the existing learner API."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text

from app.services.collections import history_page, parse_saved_cursor, saved_page


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_history_pages_match_fastapi_and_do_not_cross_accounts(session, user):
    concepts = (await session.execute(text("""
        select id from public.concepts where status = 'published' order by slug limit 3
    """))).scalars().all()
    assert len(concepts) == 3
    for day, concept_id in zip((1, 2, 3), concepts, strict=True):
        await session.execute(text("""
            insert into public.daily_assignments(user_id, concept_id, assigned_for, completed_at)
            values (:uid, :cid, make_date(2026, 1, :day), now())
        """), {"uid": user, "cid": concept_id, "day": day})
    await session.commit()

    call = text("select public.edge_api_history(:uid, :before, :limit)")
    first = _json(await session.scalar(call, {"uid": user, "before": None, "limit": 2}))
    expected_first = await history_page(session, user, None, 2)
    assert first == expected_first.model_dump(mode="json")

    second = _json(await session.scalar(call, {
        "uid": user, "before": date.fromisoformat(first["next_cursor"]), "limit": 2,
    }))
    expected_second = await history_page(session, user, date.fromisoformat(first["next_cursor"]), 2)
    assert second == expected_second.model_dump(mode="json")
    assert second["next_cursor"] is None
    assert _json(await session.scalar(call, {
        "uid": uuid.uuid4(), "before": None, "limit": 2,
    })) == {"items": [], "next_cursor": None}


@pytest.mark.asyncio
async def test_saved_pages_keep_stable_cursor_order(session, user):
    concepts = (await session.execute(text("""
        select id from public.concepts where status = 'published' order by slug limit 3
    """))).scalars().all()
    assert len(concepts) == 3
    for hour, concept_id in zip((1, 2, 3), concepts, strict=True):
        await session.execute(text("""
            insert into public.concept_interactions(user_id, concept_id, saved_at)
            values (:uid, :cid, make_timestamptz(2026, 1, 1, :hour, 0, 0, 'UTC'))
        """), {"uid": user, "cid": concept_id, "hour": hour})
    await session.commit()

    call = text("select public.edge_api_saved(:uid, :before, :cid, :limit)")
    first = _json(await session.scalar(call, {
        "uid": user, "before": None, "cid": None, "limit": 2,
    }))
    expected_first = await saved_page(session, user, None, 2)
    assert first["items"] == expected_first.model_dump(mode="json")["items"]
    assert parse_saved_cursor(first["next_cursor"]) == parse_saved_cursor(expected_first.next_cursor)

    before, concept_id = parse_saved_cursor(first["next_cursor"])
    second = _json(await session.scalar(call, {
        "uid": user, "before": before, "cid": concept_id, "limit": 2,
    }))
    expected_second = await saved_page(session, user, first["next_cursor"], 2)
    assert second == expected_second.model_dump(mode="json")
    assert second["next_cursor"] is None


@pytest.mark.asyncio
async def test_collection_rpcs_are_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated', 'public.edge_api_history(uuid,date,integer)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_saved(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_history(uuid,date,integer)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_saved(uuid,timestamptz,uuid,integer)', 'EXECUTE')
    """))).one()
    assert permissions == (False, False, True, True)
