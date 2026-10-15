"""Directed connect is owner-only, idempotent, pair-safe, and rate limited."""

import json
import uuid

import pytest
from sqlalchemy import text


CONNECT = text("select public.edge_api_relationship_connect(:uid,:token)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_directed_connect_is_idempotent_and_private(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    args = {"uid": user, "token": token}
    assert _json(await session.scalar(CONNECT, args)) == {"error": "unavailable"}
    await session.execute(text("update public.profile_sharing set enabled=true where user_id=:uid"),
                          {"uid": peer})
    assert _json(await session.scalar(CONNECT, {"uid": peer, "token": token})) == {
        "error": "unavailable"}
    first = _json(await session.scalar(CONNECT, args))
    assert first["state"] == "connected"
    assert _json(await session.scalar(CONNECT, args)) == first
    assert await session.scalar(text("select count(*) from public.connection_request_events where user_id=:uid"),
                                {"uid": user}) == 1
    assert await session.scalar(text("select count(*) from public.profile_connections where source_user_id=:uid"),
                                {"uid": peer}) == 0
    await session.execute(text("insert into public.connection_blocks(owner_id,target_id) values (:peer,:actor)"),
                          {"peer": peer, "actor": user})
    assert _json(await session.scalar(CONNECT, args)) == {"error": "unavailable"}


@pytest.mark.asyncio
async def test_directed_connect_limit_and_permissions(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    await session.execute(text("update public.profile_sharing set enabled=true where user_id=:uid"),
                          {"uid": peer})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    await session.execute(text("insert into public.connection_request_events(user_id) select :uid from generate_series(1,40)"),
                          {"uid": user})
    assert _json(await session.scalar(CONNECT, {"uid": user, "token": token})) == {
        "error": "limit", "retry_after": 86400}
    assert await session.scalar(text("select count(*) from public.profile_connections where source_user_id=:uid"),
                                {"uid": user}) == 0
    assert await session.scalar(CONNECT, {"uid": uuid.uuid4(), "token": token}) is None
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_relationship_connect(uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_relationship_connect(uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
