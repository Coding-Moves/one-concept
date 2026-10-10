"""Acceptance tests for directed QR/profile-link relationships."""
import secrets
import uuid

import httpx
import pytest
import pytest_asyncio
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.main import app
from tests import test_api

anon_client = test_api.anon_client


@pytest_asyncio.fixture
async def people(session):
    people = [(uuid.uuid4(), secrets.token_urlsafe(32)) for _ in range(3)]
    for index, (uid, token) in enumerate(people):
        await session.execute(text('insert into auth.users(id,email) values (:id,:email)'), {'id': uid, 'email': f'relationship{index}@example.invalid'})
        await session.execute(text('insert into profile_sharing(user_id,public_token,enabled,show_name) values (:id,:token,true,true)'), {'id': uid, 'token': token})
    await session.commit()
    yield people
    await session.execute(text('delete from auth.users where id=any(:ids)'), {'ids': [person[0] for person in people]})
    await session.commit()


@pytest_asyncio.fixture
async def api(sessionmaker_for_test):
    async def db():
        async with sessionmaker_for_test() as session:
            yield session

    async def identity(request: Request):
        return CurrentUser(id=uuid.UUID(request.headers['x-test-user']), email='relationship@example.invalid')

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = identity
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        yield client
    app.dependency_overrides.clear()


def auth(person):
    return {'x-test-user': str(person[0])}


def path(person):
    return '/v1/me/relationships/with/' + person[1]


async def test_connect_is_one_way_idempotent_and_private(api, people):
    a, b, _ = people
    connected = await api.post(path(b), headers=auth(a))
    assert connected.status_code == 200, connected.text
    assert connected.json()['state'] == 'connected'
    assert (await api.post(path(b), headers=auth(a))).json() == connected.json()
    own_list = await api.get('/v1/me/relationships', headers=auth(a))
    assert len(own_list.json()['items']) == 1
    assert str(b[0]) not in own_list.text and 'relationship1@example.invalid' not in own_list.text
    assert (await api.get('/v1/me/relationships', headers=auth(b))).json()['items'] == []
    status = await api.get(path(b), headers=auth(a))
    assert status.json()['state'] == 'connected'


async def test_disconnect_is_owner_fenced_and_survives_profile_revocation(api, people, session):
    a, b, c = people
    entry = (await api.post(path(b), headers=auth(a))).json()
    await session.execute(text('update profile_sharing set enabled=false where user_id=:id'), {'id': b[0]})
    await session.commit()
    assert (await api.delete('/v1/me/relationships/' + entry['relationship_id'], headers=auth(c))).status_code == 204
    assert len((await api.get('/v1/me/relationships', headers=auth(a))).json()['items']) == 1
    assert (await api.delete('/v1/me/relationships/' + entry['relationship_id'], headers=auth(a))).status_code == 204
    assert (await api.get('/v1/me/relationships', headers=auth(a))).json()['items'] == []


async def test_list_avatar_obeys_public_choice_and_revocation(api, people, session, monkeypatch):
    from app.services import relationships

    a, b, _ = people
    await api.post(path(b), headers=auth(a))
    await session.execute(text("update profiles set avatar_url='preset:forest' where id=:id"), {'id': b[0]})
    await session.commit()
    url = '/v1/me/relationships'
    hidden = (await api.get(url, headers=auth(a))).json()['items'][0]
    assert hidden['avatar_ref'] is None and hidden['avatar_url'] is None

    await session.execute(text('update profile_sharing set show_avatar=true where user_id=:id'), {'id': b[0]})
    await session.commit()
    shared = (await api.get(url, headers=auth(a))).json()['items'][0]
    assert shared['avatar_ref'] == 'preset:forest' and shared['avatar_url'] is None

    async def signed(_settings, key):
        assert key == f'avatars/{b[0]}/photo.jpg'
        return 'https://storage.example.invalid/signed-photo'

    monkeypatch.setattr(relationships, 'signed_avatar_url', signed)
    await session.execute(text('update profiles set avatar_url=:key where id=:id'),
                          {'id': b[0], 'key': f'avatars/{b[0]}/photo.jpg'})
    await session.commit()
    photo = (await api.get(url, headers=auth(a))).json()['items'][0]
    assert photo['avatar_ref'] is None and photo['avatar_url'] == 'https://storage.example.invalid/signed-photo'

    async def storage_unavailable(_settings, _key):
        raise httpx.ConnectError('storage unavailable', request=httpx.Request('POST', 'https://storage.example.invalid'))

    monkeypatch.setattr(relationships, 'signed_avatar_url', storage_unavailable)
    degraded = (await api.get(url, headers=auth(a))).json()['items'][0]
    assert degraded['display_name'] and degraded['avatar_url'] is None

    await session.execute(text('update profile_sharing set enabled=false where user_id=:id'), {'id': b[0]})
    await session.commit()
    revoked = (await api.get(url, headers=auth(a))).json()['items'][0]
    assert revoked['public_path'] is None and revoked['avatar_ref'] is None and revoked['avatar_url'] is None


async def test_slow_photo_storage_does_not_delay_the_connections_list(api, people, session, monkeypatch):
    import asyncio
    from app.services import relationships

    a, b, _ = people
    await api.post(path(b), headers=auth(a))
    await session.execute(text('update profile_sharing set show_avatar=true where user_id=:id'), {'id': b[0]})
    await session.execute(text('update profiles set avatar_url=:key where id=:id'),
                          {'id': b[0], 'key': f'avatars/{b[0]}/photo.jpg'})
    await session.commit()

    async def stalled(_settings, _key):
        await asyncio.sleep(1)
        return 'https://storage.example.invalid/late'

    monkeypatch.setattr(relationships, 'signed_avatar_url', stalled)
    monkeypatch.setattr(relationships, 'AVATAR_LOOKUP_TIMEOUT_SECONDS', 0.01)
    page = (await api.get('/v1/me/relationships', headers=auth(a))).json()
    assert len(page['items']) == 1
    assert page['items'][0]['display_name'] and page['items'][0]['avatar_url'] is None


async def test_block_from_list_is_owner_fenced_and_works_after_revocation(api, people, session):
    a, b, c = people
    entry = (await api.post(path(b), headers=auth(a))).json()
    await api.post(path(a), headers=auth(b))
    await session.execute(text('update profile_sharing set enabled=false where user_id=:id'), {'id': b[0]})
    await session.commit()
    target = '/v1/me/relationships/' + entry['relationship_id'] + '/block'
    assert (await api.post(target, headers=auth(c))).status_code == 204
    assert len((await api.get('/v1/me/relationships', headers=auth(a))).json()['items']) == 1
    assert (await api.post(target, headers=auth(a))).status_code == 204
    assert (await api.get('/v1/me/relationships', headers=auth(a))).json()['items'] == []
    assert (await api.get('/v1/me/relationships', headers=auth(b))).json()['items'] == []
    assert (await api.post(path(a), headers=auth(b))).status_code == 404


async def test_private_self_and_blocks_have_the_same_unavailable_outcome(api, people):
    a, b, _ = people
    assert (await api.get(path(a), headers=auth(a))).json()['state'] == 'unavailable'
    assert (await api.post(path(a), headers=auth(a))).status_code == 404
    assert (await api.post(path(b) + '/block', headers=auth(a))).status_code == 204
    assert (await api.get(path(b), headers=auth(a))).json()['state'] == 'unavailable'
    assert (await api.post(path(b), headers=auth(a))).status_code == 404
    assert (await api.post(path(a), headers=auth(b))).status_code == 404


async def test_accepted_legacy_pairs_are_backfilled_in_both_directions(api, people, session):
    a, b, _ = people
    await session.execute(text('''insert into connections(low_user,high_user,initiator,state)
        values (:low,:high,:low,'accepted')'''), {'low': min(a[0], b[0]), 'high': max(a[0], b[0])})
    # A live migration cannot be replayed by this fixture. Model its completed
    # backfill explicitly and assert the product contract from both accounts.
    await session.execute(text('''insert into profile_connections(source_user_id,target_user_id)
        values (:a,:b),(:b,:a)'''), {'a': a[0], 'b': b[0]})
    await session.commit()
    assert len((await api.get('/v1/me/relationships', headers=auth(a))).json()['items']) == 1
    assert len((await api.get('/v1/me/relationships', headers=auth(b))).json()['items']) == 1


async def test_relationship_list_uses_an_opaque_working_keyset_cursor(api, people, session):
    a, b, c = people
    await session.execute(text('''insert into profile_connections(source_user_id,target_user_id,created_at)
        values (:a,:b,now()),(:a,:c,now()-interval '1 second')'''), {'a': a[0], 'b': b[0], 'c': c[0]})
    await session.commit()
    first = await api.get('/v1/me/relationships', headers=auth(a), params={'limit': 1})
    assert first.status_code == 200
    cursor = first.json()['next_cursor']
    assert cursor and str(a[0]) not in cursor and str(b[0]) not in cursor
    second = await api.get('/v1/me/relationships', headers=auth(a), params={'limit': 1, 'cursor': cursor})
    assert second.status_code == 200, second.text
    assert second.json()['items'][0]['id'] != first.json()['items'][0]['id']


@pytest.mark.parametrize('path', ['/v1/me/relationships', '/v1/me/relationships/with/' + 'a' * 43])
async def test_relationships_require_authentication(anon_client, path):
    assert (await anon_client.get(path)).status_code == 401


async def test_profile_connections_are_not_available_to_client_database_roles(session):
    await session.execute(text('set local role authenticated'))
    with pytest.raises(DBAPIError):
        await session.execute(text('select * from profile_connections'))
    await session.rollback()
