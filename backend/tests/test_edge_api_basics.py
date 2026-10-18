"""The candidate Edge RPCs use real PostgreSQL and never trust a caller UID."""

import json

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_edge_topics_matches_active_catalog_and_following(session, user):
    topic = (
        await session.execute(text("select id, slug from public.topics where is_active order by sort_order limit 1"))
    ).one()
    await session.execute(
        text("insert into public.user_topics (user_id, topic_id) values (:uid, :tid) on conflict do nothing"),
        {"uid": user, "tid": topic.id},
    )
    await session.commit()

    result = await session.scalar(
        text("select public.edge_api_topics(:uid)"), {"uid": user}
    )
    rows = json.loads(result) if isinstance(result, str) else result
    selected = next(row for row in rows if row["slug"] == topic.slug)
    assert selected["following"] is True
    assert type(selected["concept_count"]) is int
    assert "sort_order" not in selected
    assert all(set(row) == {"id", "slug", "name", "description", "concept_count", "following"} for row in rows)


@pytest.mark.asyncio
async def test_edge_rpc_permissions_and_health(session):
    rows = (
        await session.execute(
            text("""
                select
                  has_function_privilege('authenticated', 'public.edge_api_health()', 'EXECUTE') as auth_health,
                  has_function_privilege('authenticated', 'public.edge_api_topics(uuid)', 'EXECUTE') as auth_topics,
                  has_function_privilege('service_role', 'public.edge_api_health()', 'EXECUTE') as service_health,
                  has_function_privilege('service_role', 'public.edge_api_topics(uuid)', 'EXECUTE') as service_topics
            """)
        )
    ).one()
    assert rows == (False, False, True, True)
    health = await session.scalar(text("select public.edge_api_health()"))
    health = json.loads(health) if isinstance(health, str) else health
    assert health == {"status": "ok", "database": "reachable"}
