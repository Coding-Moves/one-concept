"""Shared-profile connection status reveals only the caller's own pair."""

import json
import uuid

import pytest
from sqlalchemy import text


STATUS = text("select public.edge_api_connection_status(:uid,:token)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_status_follows_visibility_requests_cooldown_and_blocks(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": user})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    default = {"state": "unavailable", "id": None, "retry_after": None}
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == default
    await session.execute(text("update public.profile_sharing set enabled=true where user_id in (:actor,:peer)"),
                          {"actor": user, "peer": peer})
    await session.execute(text("insert into public.connection_preferences(user_id,accepting_requests) values (:uid,true)"),
                          {"uid": peer})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token}))["state"] == "available"
    assert _json(await session.scalar(STATUS, {"uid": peer, "token": token}))["state"] == "self"

    pair = uuid.uuid4()
    await session.execute(text("""insert into public.connections
      (id,low_user,high_user,initiator,state)
      values (:id,:low,:high,:actor,'pending')"""),
      {"id": pair, "low": min(user, peer), "high": max(user, peer), "actor": user})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == {
        "state": "outgoing", "id": str(pair), "retry_after": None}
    await session.execute(text("update public.connections set initiator=:peer where id=:id"),
                          {"peer": peer, "id": pair})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token}))["state"] == "incoming"
    await session.execute(text("update public.connections set state='accepted' where id=:id"), {"id": pair})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token}))["state"] == "accepted"
    await session.execute(text("update public.connections set state='removed',changed_at=now() where id=:id"),
                          {"id": pair})
    cooldown = _json(await session.scalar(STATUS, {"uid": user, "token": token}))
    assert cooldown["state"] == "cooldown" and 0 < cooldown["retry_after"] <= 7 * 86400
    await session.execute(text("""update public.connections
      set changed_at=now()-interval '8 days' where id=:id"""), {"id": pair})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token}))["state"] == "available"
    await session.execute(text("insert into public.connection_blocks(owner_id,target_id) values (:peer,:actor)"),
                          {"peer": peer, "actor": user})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == default
    await session.execute(text("update public.profile_sharing set enabled=false where user_id=:peer"),
                          {"peer": peer})
    assert _json(await session.scalar(STATUS, {"uid": user, "token": token})) == default


@pytest.mark.asyncio
async def test_connection_status_missing_profile_and_permissions(session, user):
    assert await session.scalar(STATUS, {"uid": uuid.uuid4(), "token": "a" * 43}) is None
    assert _json(await session.scalar(STATUS, {"uid": user, "token": "bad"}))["state"] == "unavailable"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_connection_status(uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connection_status(uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
