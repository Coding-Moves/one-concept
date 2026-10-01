"""Preferred-name writes remain private and scoped to the authenticated account."""
import uuid

import pytest
from sqlalchemy import text

from tests import test_api

client = test_api.client
anon_client = test_api.anon_client


@pytest.mark.parametrize('name', ['', '   ', 'x' * 61, 'hello\nthere', 'hello\u202ethere'])
async def test_reject_invalid_name(client, name):
    assert (await client.patch('/v1/me', json={'display_name': name})).status_code == 422


async def test_name_update_is_normalized_and_scoped(client, session, user):
    other = uuid.uuid4()
    await session.execute(text('insert into auth.users (id,email) values (:id,:email)'),
                          {'id': other, 'email': 'private@example.invalid'})
    await session.commit()
    before = await session.scalar(text('select display_name from profiles where id=:id'), {'id': other})
    result = await client.patch('/v1/me?compact=true', json={'display_name': '  Jose\u0301  ', 'id': str(other)})
    assert result.status_code == 200
    assert result.json()['display_name'] == 'José'
    assert await session.scalar(text('select display_name from profiles where id=:id'), {'id': other}) == before
    assert await session.scalar(text('select display_name from profiles where id=:id'), {'id': user}) == 'José'


async def test_name_requires_authentication(anon_client):
    assert (await anon_client.patch('/v1/me', json={'display_name': 'Someone'})).status_code == 401


async def test_phone_timezone_initializes_once_and_preserves_explicit_preference(client, session, user):
    first = await client.patch('/v1/me?compact=true', json={'timezone': 'Asia/Karachi', 'initialize_timezone': True})
    assert first.status_code == 200 and first.json()['timezone'] == 'Asia/Karachi'
    second = await client.patch('/v1/me?compact=true', json={'timezone': 'America/New_York', 'initialize_timezone': True})
    assert second.json()['timezone'] == 'Asia/Karachi'
    manual = await client.patch('/v1/me?compact=true', json={'timezone': 'UTC'})
    assert manual.json()['timezone'] == 'UTC'
    phone = await client.patch('/v1/me?compact=true', json={'timezone': 'Asia/Karachi', 'initialize_timezone': True})
    assert phone.json()['timezone'] == 'UTC'
    assert await session.scalar(text('select timezone_initialized from profiles where id=:uid'), {'uid': user})
