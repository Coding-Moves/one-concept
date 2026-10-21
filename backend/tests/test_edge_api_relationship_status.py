"""Directed status is scoped to the verified caller and current token visibility."""

import json
import uuid

import pytest
from sqlalchemy import text


STATUS = text("select public.edge_api_relationship_status(:uid,:token)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_directed_status_visibility_and_owner_scope(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    unavailable = {"state": "unavailable", "relationship_id": None}
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == unavailable
    await session.execute(text("update public.profile_sharing set enabled=true where user_id=:uid"),
                          {"uid": peer})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == {
        "state": "available", "relationship_id": None}
    assert _json(await session.scalar(STATUS, {"uid": peer, "token": token})) == unavailable

    relationship = await session.scalar(text("""insert into public.profile_connections
      (source_user_id,target_user_id) values (:actor,:peer) returning id"""),
      {"actor": user, "peer": peer})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == {
        "state": "connected", "relationship_id": str(relationship)}
    assert _json(await session.scalar(STATUS, {"uid": peer, "token": token})) == unavailable
    await session.execute(text("insert into public.connection_blocks(owner_id,target_id) values (:peer,:actor)"),
                          {"peer": peer, "actor": user})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == unavailable


@pytest.mark.asyncio
async def test_directed_status_missing_profile_and_permissions(session, user):
    assert await session.scalar(STATUS, {"uid": uuid.uuid4(), "token": "a" * 43}) is None
    assert _json(await session.scalar(STATUS, {"uid": user, "token": "bad"})) == {
        "state": "unavailable", "relationship_id": None}
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_relationship_status(uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_relationship_status(uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
