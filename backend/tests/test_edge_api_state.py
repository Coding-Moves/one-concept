"""The candidate startup snapshot folds one server-owned daily activity into state."""

import json
from datetime import date

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)
CALL = text("select public.edge_api_state(:uid, :compact, :reviews, 10, 60, 90, :day)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_startup_state_folds_stable_daily_and_current_account(session, user):
    args = {"uid": user, "compact": True, "reviews": True, "day": DAY}
    first = _json(await session.scalar(CALL, args))
    assert first["today"] == DAY.isoformat()
    assert first["daily_availability"] == "available"
    assert first["daily"]["concept"]["slug"] == first["assignment_slug"]
    assert first["review"] is None
    assert first["stats"] == {"current": 0, "longest": 0, "total_learned": 0, "total_reviews": 0}
    assert first["learned"] == first["saved"] == first["likes"] == first["bookmarks"] == []
    assert first["bookmark_versions"] == []
    assert first["learned_before_window"] == {}
    assert first["history_next_cursor"] is first["saved_next_cursor"] is None
    assert first["avatar_url"] is None
    await session.commit()
    repeated = _json(await session.scalar(CALL, args))
    assert repeated["daily"] == first["daily"]
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid"),
                                {"uid": user}) == 1


@pytest.mark.asyncio
async def test_compact_state_bounds_details_and_keeps_membership_versions(session, user):
    await session.execute(text("""
        insert into public.concepts(topic_id, slug, title, summary)
        select (select id from public.topics where slug='computer-science'),
               'edge-state-' || n, 'State lesson ' || n, 'Fixture summary'
          from generate_series(1, 51) n
    """))
    concepts = (await session.execute(text("""
        select id from public.concepts where slug like 'edge-state-%' order by id
    """))).scalars().all()
    assert len(concepts) == 51
    for n, cid in enumerate(concepts, 1):
        await session.execute(text("""
            insert into public.daily_assignments(user_id, concept_id, assigned_for, completed_at)
            values (:uid, :cid, cast(:day as date) - cast(:n as integer), now())
        """), {"uid": user, "cid": cid, "day": DAY, "n": n})
        await session.execute(text("""
            insert into public.concept_interactions(user_id, concept_id, saved_at)
            values (:uid, :cid, now() - make_interval(secs => :n))
        """), {"uid": user, "cid": cid, "n": n})
    await session.commit()
    result = _json(await session.scalar(CALL, {
        "uid": user, "compact": True, "reviews": False, "day": DAY,
    }))
    assert len(result["learned"]) == len(result["saved"]) == 50
    assert len(result["bookmarks"]) == len(result["bookmark_versions"]) == 51
    assert result["history_next_cursor"] and result["saved_next_cursor"]
    assert sum(result["learned_before_window"].values()) == 1
    assert result["stats"]["total_learned"] == 51


@pytest.mark.asyncio
async def test_exhausted_followed_topic_offers_review_only_when_requested(session, user):
    topic_id = await session.scalar(text("""
        select topic_id from public.concepts where status='published'
        group by topic_id order by count(*) limit 1
    """))
    await session.execute(text("delete from public.user_topics where user_id=:uid"), {"uid": user})
    await session.execute(text("insert into public.user_topics(user_id,topic_id) values (:uid,:tid)"),
                          {"uid": user, "tid": topic_id})
    await session.execute(text("""
        insert into public.daily_assignments(user_id, concept_id, assigned_for, completed_at)
        select :uid, c.id, cast(:day as date) - row_number() over(order by c.id)::integer, now()
        from public.concepts c where c.topic_id=:tid and c.status='published'
    """), {"uid": user, "tid": topic_id, "day": DAY})
    await session.commit()
    no_review = _json(await session.scalar(CALL, {
        "uid": user, "compact": True, "reviews": False, "day": DAY,
    }))
    assert no_review["daily"] is None
    assert no_review["review"] is None
    assert no_review["daily_availability"] == "catalog_exhausted"
    offered = _json(await session.scalar(CALL, {
        "uid": user, "compact": True, "reviews": True, "day": DAY,
    }))
    assert offered["daily"] is None
    assert offered["review"]["review_id"]
    assert offered["daily_availability"] == "review_available"
    assert offered["assignment_slug"] is None


@pytest.mark.asyncio
async def test_state_rpc_is_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated',
            'public.edge_api_state(uuid,boolean,boolean,integer,integer,integer,date)', 'EXECUTE'),
          has_function_privilege('service_role',
            'public.edge_api_state(uuid,boolean,boolean,integer,integer,integer,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, True)
