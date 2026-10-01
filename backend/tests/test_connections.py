"""HTTP acceptance tests use isolated PostgreSQL and explicit test identities."""
import asyncio
import secrets
import uuid

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
        await session.execute(text('insert into auth.users(id,email) values (:uid,:email)'), {'uid': uid, 'email': f'person{index}@example.invalid'})
        await session.execute(text('insert into profile_sharing(user_id,public_token,enabled,show_name) values (:uid,:token,true,true)'), {'uid': uid, 'token': token})
        await session.execute(text('insert into connection_preferences(user_id,accepting_requests) values (:uid,true)'), {'uid': uid})
    await session.commit()
    yield people
    await session.execute(text('delete from auth.users where id=any(:ids)'), {'ids': [p[0] for p in people]})
    await session.commit()


@pytest_asyncio.fixture
async def api(sessionmaker_for_test):
    async def db():
        async with sessionmaker_for_test() as session:
            yield session
    async def identity(request: Request):
        return CurrentUser(id=uuid.UUID(request.headers['x-test-user']), email='test@example.invalid')
    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = identity
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        yield client
    app.dependency_overrides.clear()


def auth(person):
    return {'x-test-user': str(person[0])}


async def send(api, a, b):
    return await api.post('/v1/me/connections/with/' + b[1], headers=auth(a))


async def action(api, person, connection, verb):
    return await api.post(f'/v1/me/connections/{connection}/actions', headers=auth(person), json={'action': verb})


async def listing(api, person, kind='accepted', **query):
    return await api.get('/v1/me/connections', headers=auth(person), params={'kind': kind, **query})


async def test_full_mutual_lifecycle_and_ownership(api, people):
    a, b, c = people
    created = await send(api, a, b)
    assert created.status_code == 200, created.text
    pair = created.json()['id']
    assert created.json()['state'] == 'outgoing'
    assert (await send(api, a, b)).json() == created.json()
    assert (await send(api, b, a)).status_code == 409  # crossed invitation is not consent
    assert (await listing(api, a, 'outgoing')).json()['items'][0]['id'] == pair
    assert (await listing(api, b, 'incoming')).json()['items'][0]['id'] == pair
    assert (await listing(api, c, 'incoming')).json()['items'] == []
    assert (await action(api, c, pair, 'accept')).status_code == 404
    assert (await action(api, a, pair, 'accept')).status_code == 403
    assert (await action(api, a, pair, 'decline')).status_code == 403
    assert (await action(api, b, pair, 'cancel')).status_code == 403
    assert (await action(api, b, pair, 'accept')).status_code == 204
    assert (await action(api, b, pair, 'accept')).status_code == 204
    for owner in [a, b]:
        result = await listing(api, owner)
        assert len(result.json()['items']) == 1
        assert 'email' not in result.text and str(a[0]) not in result.text and str(b[0]) not in result.text
        assert result.headers['cache-control'].startswith('no-store')
    assert (await action(api, a, pair, 'remove')).status_code == 204
    assert (await action(api, a, pair, 'remove')).status_code == 204
    assert (await listing(api, b)).json()['items'] == []
    again = await send(api, a, b)
    assert again.status_code == 429 and int(again.headers['retry-after']) > 0


@pytest.mark.parametrize('verb,recipient', [('decline', 1), ('cancel', 0)])
async def test_decline_cancel_and_cooldown(api, people, verb, recipient):
    a, b, _ = people
    pair = (await send(api, a, b)).json()['id']
    assert (await action(api, people[recipient], pair, verb)).status_code == 204
    assert (await listing(api, b, 'incoming')).json()['items'] == []
    assert (await send(api, a, b)).status_code == 429


async def test_block_unblock_private_lists_and_no_automatic_reconnect(api, people):
    a, b, c = people
    pair = (await send(api, a, b)).json()['id']
    await action(api, b, pair, 'accept')
    assert (await action(api, b, pair, 'block')).status_code == 204
    assert (await listing(api, a)).json()['items'] == []
    assert (await listing(api, b)).json()['items'] == []
    assert (await send(api, a, b)).status_code == 404
    status = (await api.get('/v1/me/connections/with/' + b[1], headers=auth(a))).json()
    assert status['state'] == 'unavailable' and status['id'] is None
    block = (await listing(api, b, 'blocked')).json()['items'][0]
    assert block['public_path'] is None
    assert (await listing(api, c, 'blocked')).json()['items'] == []
    assert (await api.delete('/v1/me/connections/blocks/' + block['id'], headers=auth(c))).status_code == 204
    assert len((await listing(api, b, 'blocked')).json()['items']) == 1
    assert (await api.delete('/v1/me/connections/blocks/' + block['id'], headers=auth(b))).status_code == 204
    assert (await listing(api, b)).json()['items'] == []
    assert (await send(api, a, b)).status_code == 429


async def test_public_privacy_changes_are_reflected_without_cached_names(api, people, session):
    a, b, _ = people
    pair = (await send(api, a, b)).json()['id']
    await action(api, b, pair, 'accept')
    await session.execute(text('update profile_sharing set show_name=false where user_id=:uid'), {'uid': b[0]})
    await session.commit()
    item = (await listing(api, a)).json()['items'][0]
    assert item['display_name'] == 'Private learner'
    await session.execute(text('update profile_sharing set enabled=false where user_id=:uid'), {'uid': b[0]})
    await session.commit()
    item = (await listing(api, a)).json()['items'][0]
    assert item['display_name'] == 'Private learner' and item['public_path'] is None
    assert (await send(api, people[2], b)).status_code == 404
    assert (await action(api, a, pair, 'remove')).status_code == 204


async def test_opt_in_settings_self_request_and_revocation(api, people, session):
    a, b, _ = people
    await session.execute(text('delete from connection_preferences where user_id=:uid'), {'uid': b[0]})
    await session.commit()
    result = await api.get('/v1/me/connections/settings', headers=auth(b))
    assert result.json() == {'accepting_requests': False, 'version': 0}
    assert (await send(api, a, b)).status_code == 404
    assert (await send(api, a, a)).status_code == 400
    result = await api.put('/v1/me/connections/settings', headers=auth(b), json={'accepting_requests': True, 'version': 0})
    assert result.status_code == 200
    assert (await api.put('/v1/me/connections/settings', headers=auth(b), json={'accepting_requests': False, 'version': 0})).status_code == 409
    assert (await api.put('/v1/me/connections/settings', headers=auth(a), json={'accepting_requests': True, 'version': 0, 'user_id': str(b[0])})).status_code == 422
    await session.execute(text('update profile_sharing set enabled=false where user_id=:uid'), {'uid': a[0]})
    await session.commit()
    assert (await send(api, a, b)).status_code == 404


async def test_database_limits_and_cooldown_expiry(api, people, session):
    a, b, _ = people
    await session.execute(text('insert into connection_request_events(user_id) select :uid from generate_series(1,20)'), {'uid': a[0]})
    await session.commit()
    assert (await send(api, a, b)).status_code == 429
    await session.execute(text("update connection_request_events set requested_at=now()-interval '25 hours' where user_id=:uid"), {'uid': a[0]})
    await session.commit()
    response = await send(api, a, b)
    assert response.status_code == 200
    pair = response.json()['id']
    await action(api, b, pair, 'decline')
    await session.execute(text("update connections set changed_at=now()-interval '8 days' where id=:id"), {'id': uuid.UUID(pair)})
    await session.commit()
    assert (await send(api, a, b)).status_code == 200
    assert await session.scalar(text('select count(*) from connection_request_events where user_id=:uid'), {'uid': a[0]}) == 2


async def test_concurrent_requests_and_pagination(api, people, session):
    a, b, c = people
    responses = await asyncio.gather(send(api, a, b), send(api, b, a))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert await session.scalar(text('select count(*) from connections where low_user=:low and high_user=:high'), {'low': min(a[0], b[0]), 'high': max(a[0], b[0])}) == 1
    # A has two pending entries, one in each direction is sufficient to check bounded lists.
    await send(api, c, a)
    incoming = (await listing(api, a, 'incoming', limit=1)).json()
    assert len(incoming['items']) == 1
    if incoming['next_cursor']:
        next_page = (await listing(api, a, 'incoming', limit=1, cursor=incoming['next_cursor'])).json()
        assert next_page['items'][0]['id'] != incoming['items'][0]['id']
    assert (await listing(api, a, limit=51)).status_code == 422


@pytest.mark.parametrize('table', ['connections', 'connection_blocks', 'connection_preferences', 'connection_request_events'])
async def test_direct_user_access_denied(session, table):
    await session.execute(text('set local role authenticated'))
    with pytest.raises(DBAPIError):
        await session.execute(text('select * from ' + table))
    await session.rollback()


async def test_authentication_required(anon_client):
    for path in ['/v1/me/connections', '/v1/me/connections/settings', '/v1/me/connections/with/' + 'a'*43]:
        assert (await anon_client.get(path)).status_code == 401
    assert (await anon_client.post('/v1/me/connections/with/' + 'a'*43)).status_code == 401
