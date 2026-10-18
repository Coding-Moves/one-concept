"""Subtopic Edge RPCs match the existing account-scoped learning contract."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.services.subtopic_progress import progress, record_completion


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_subtopic_progress_matches_python_before_and_after_completion(session, user):
    call = text("select public.edge_api_subtopic_progress(:uid)")
    expected = [vars(item) for item in await progress(session, user)]
    assert _json(await session.scalar(call, {"uid": user})) == {"items": json.loads(json.dumps(expected, default=str))}

    concepts = (await session.execute(text("""
        select c.id from public.concepts c
        join public.subtopics s on s.id = c.subtopic_id
        where s.slug = 'probability' and c.status = 'published' order by c.id
    """))).scalars().all()
    assert len(concepts) >= 3
    await session.execute(text("""
        insert into public.user_concept_completions(user_id, concept_id)
        select :uid, unnest(cast(:ids as uuid[]))
    """), {"uid": user, "ids": concepts})
    event = await record_completion(session, user, concepts[0])
    assert event is not None
    await session.commit()

    expected = [vars(item) for item in await progress(session, user)]
    actual = _json(await session.scalar(call, {"uid": user}))
    assert actual == {"items": json.loads(json.dumps(expected, default=str))}
    assert _json(await session.scalar(call, {"uid": uuid.uuid4()}))["items"] != actual["items"]


@pytest.mark.asyncio
async def test_subtopic_acknowledgment_is_idempotent_and_account_scoped(session, user):
    concepts = (await session.execute(text("""
        select c.id from public.concepts c
        join public.subtopics s on s.id = c.subtopic_id
        where s.slug = 'probability' and c.status = 'published' order by c.id
    """))).scalars().all()
    await session.execute(text("""
        insert into public.user_concept_completions(user_id, concept_id)
        select :uid, unnest(cast(:ids as uuid[]))
    """), {"uid": user, "ids": concepts})
    event = await record_completion(session, user, concepts[0])
    assert event is not None
    await session.commit()

    call = text("select public.edge_api_mark_subtopics_seen(:uid, :ids)")
    assert await session.scalar(call, {"uid": uuid.uuid4(), "ids": [event.id]}) is True
    assert await session.scalar(text("select seen_at is null from public.user_subtopic_completions where id = :id"), {"id": event.id}) is True
    assert await session.scalar(call, {"uid": user, "ids": [event.id]}) is True
    first_seen = await session.scalar(text("select seen_at from public.user_subtopic_completions where id = :id"), {"id": event.id})
    assert first_seen is not None
    assert await session.scalar(call, {"uid": user, "ids": [event.id]}) is True
    assert await session.scalar(text("select seen_at from public.user_subtopic_completions where id = :id"), {"id": event.id}) == first_seen


@pytest.mark.asyncio
async def test_subtopic_rpcs_are_service_only(session):
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated', 'public.edge_api_subtopic_progress(uuid)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.edge_api_mark_subtopics_seen(uuid,uuid[])', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_subtopic_progress(uuid)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.edge_api_mark_subtopics_seen(uuid,uuid[])', 'EXECUTE')
    """))).one()
    assert permissions == (False, False, True, True)
