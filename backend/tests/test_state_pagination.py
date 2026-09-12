"""Large accounts retain totals and full collection access with compact startup."""

import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.main import app


@pytest_asyncio.fixture
async def collection_client(session, sessionmaker_for_test, user):
    prefix = f"collection-{user}-"
    await session.execute(text("""
        insert into public.concepts (topic_id, slug, title, summary)
        select (select id from public.topics where slug = 'computer-science'),
               :prefix || n, 'Lesson ' || n, 'Fixture summary'
          from generate_series(1, 365) n
    """), {"prefix": prefix})
    await session.execute(text("""
        insert into public.daily_assignments (user_id, concept_id, assigned_for, completed_at)
        select :uid, id, current_date - cast(substring(slug from length(:prefix) + 1) as int), now()
          from public.concepts where starts_with(slug, :prefix)
    """), {"prefix": prefix, "uid": user})
    await session.execute(text("""
        insert into public.concept_interactions (user_id, concept_id, liked_at, saved_at)
        select :uid, id, now(), now()
          from public.concepts where starts_with(slug, :prefix)
    """), {"prefix": prefix, "uid": user})
    await session.commit()

    async def db():
        async with sessionmaker_for_test() as value:
            yield value

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=user, email="fixture@example.invalid")
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.clear()


async def test_compact_state_bounds_details_without_losing_totals(collection_client):
    legacy = await collection_client.get("/v1/me/state")
    compact = await collection_client.get("/v1/me/state?compact=true")
    assert legacy.status_code == compact.status_code == 200
    before, after = legacy.json(), compact.json()
    print(f"state bytes: legacy={len(legacy.content)}, compact={len(compact.content)}; "
          f"detail rows: learned={len(after['learned'])}, saved={len(after['saved'])}")
    assert len(before["learned"]) == len(before["saved"]) == 365
    assert len(after["learned"]) == len(after["saved"]) == 50
    assert len(after["likes"]) == len(after["bookmarks"]) == 365
    assert after["stats"] == before["stats"] == {"current": 365, "longest": 365, "total_learned": 365}
    assert after["learned_before_window"] == {"Computer Science": 315}
    assert after["history_next_cursor"] and after["saved_next_cursor"]
    assert len(compact.content) < len(legacy.content) / 2


async def test_pages_cover_history_and_tied_saves(collection_client):
    state = (await collection_client.get('/v1/me/state?compact=true')).json()
    for path, field, cursor_field in (
        ('history', 'learned', 'history_next_cursor'),
        ('saved', 'saved', 'saved_next_cursor'),
    ):
        items = state[field][:]
        cursor = state[cursor_field]
        while cursor:
            response = await collection_client.get(f'/v1/me/{path}', params={'cursor': cursor, 'limit': 37})
            assert response.status_code == 200, response.text
            page = response.json()
            assert 0 < len(page['items']) <= 37
            items.extend(page['items'])
            cursor = page['next_cursor']
        assert len(items) == len({item['concept_slug'] for item in items}) == 365
        assert all(item['like_count'] == 0 for item in items)  # own likes excluded
        full = (await collection_client.get('/v1/me/state')).json()[field]
        assert items == full


async def test_state_mutations_support_compact_clients(collection_client):
    for response in (
        await collection_client.put('/v1/me/topics?compact=true', json={'topics': ['computer-science']}),
        await collection_client.patch('/v1/me?compact=true', json={'display_name': 'Updated'}),
    ):
        assert response.status_code == 200, response.text
        assert len(response.json()['learned']) == len(response.json()['saved']) == 50
        assert response.json()['learned_before_window'] == {'Computer Science': 315}
    legacy = await collection_client.patch('/v1/me', json={'display_name': 'Legacy'})
    assert len(legacy.json()['learned']) == len(legacy.json()['saved']) == 365


async def test_empty_and_other_user_collections(collection_client, session, user):
    from app.services.collections import saved_cursor
    from datetime import datetime, timezone

    # A cursor contains ordering only; it cannot choose which user's rows to read.
    other = uuid.uuid4()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=other, email='other@example.invalid')
    for path in ('saved', 'history'):
        result = await collection_client.get(f'/v1/me/{path}')
        assert result.json() == {'items': [], 'next_cursor': None}
    cursor = saved_cursor(datetime.now(timezone.utc).isoformat(), str(user))
    assert (await collection_client.get('/v1/me/saved', params={'cursor': cursor})).json()['items'] == []


async def test_cursor_validation_and_limits(collection_client):
    import base64
    import json

    for cursor in ('not-a-cursor', base64.urlsafe_b64encode(json.dumps([
        '2026-01-01T00:00:00', str(uuid.uuid4()),
    ]).encode()).decode(), base64.urlsafe_b64encode(b'[42, 42]').decode()):
        result = await collection_client.get('/v1/me/saved', params={'cursor': cursor})
        assert result.status_code == 400
    assert (await collection_client.get('/v1/me/history?cursor=bad')).status_code == 422
    for path in ('saved', 'history'):
        for limit in (0, 101):
            assert (await collection_client.get(f'/v1/me/{path}?limit={limit}')).status_code == 422
        response = await collection_client.get(f'/v1/me/{path}?limit=100')
        assert len(response.json()['items']) == 100


async def test_saved_deletion_between_pages_does_not_skip_rows(collection_client, session, user):
    first = (await collection_client.get('/v1/me/saved?limit=10')).json()
    await session.execute(text('''
        update public.concept_interactions set saved_at = null
         where user_id = :uid and concept_id = (
             select id from public.concepts where slug = :slug
         )
    '''), {'uid': user, 'slug': first['items'][-1]['concept_slug']})
    await session.commit()
    second = (await collection_client.get('/v1/me/saved', params={
        'cursor': first['next_cursor'], 'limit': 100,
    })).json()
    all_remaining = (await collection_client.get('/v1/me/state')).json()['saved']
    assert second['items'] == all_remaining[9:109]


async def test_exact_window_has_no_cursor(collection_client, session, user):
    await session.execute(text('''
        delete from public.daily_assignments where user_id = :uid
         and assigned_for < current_date - 50
    '''), {'uid': user})
    await session.execute(text('''
        update public.concept_interactions set saved_at = null where user_id = :uid
         and concept_id not in (select concept_id from public.daily_assignments where user_id = :uid)
    '''), {'uid': user})
    await session.commit()
    state = (await collection_client.get('/v1/me/state?compact=true')).json()
    assert len(state['learned']) == len(state['saved']) == 50
    assert state['learned_before_window'] == {}
    assert state['history_next_cursor'] is state['saved_next_cursor'] is None
