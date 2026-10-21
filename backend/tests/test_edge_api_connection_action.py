"""Legacy connection actions are owner-bound and reject stale request IDs."""

import json
import uuid

import pytest
from sqlalchemy import text


ACTION = text("select public.edge_api_connection_action(:uid,:id,:action)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


async def _pair(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    pair = await session.scalar(text("""insert into public.connections
      (low_user,high_user,initiator,state)
      values (:low,:high,:actor,'pending') returning id"""),
      {"low": min(user, peer), "high": max(user, peer), "actor": user})
    return peer, pair


@pytest.mark.asyncio
async def test_connection_action_permissions_idempotence_and_block(session, user):
    peer, pair = await _pair(session, user)
    args = {"uid": user, "id": pair, "action": "accept"}
    assert _json(await session.scalar(ACTION, args)) == {"error": "recipient_only"}
    args["uid"] = peer
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    assert await session.scalar(text("select state from public.connections where id=:id"),
                                {"id": pair}) == "accepted"
    args["action"] = "remove"
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    args["action"] = "block"
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.connection_blocks where owner_id=:uid"),
                                {"uid": peer}) == 1
    args["action"] = "remove"
    assert _json(await session.scalar(ACTION, args)) == {"error": "unavailable"}
    args["uid"] = uuid.uuid4()
    assert _json(await session.scalar(ACTION, args)) == {"error": "unavailable"}


@pytest.mark.asyncio
async def test_connection_action_rejects_stale_invitation_and_invalid_action(session, user):
    peer, pair = await _pair(session, user)
    args = {"uid": peer, "id": pair, "action": "cancel"}
    assert _json(await session.scalar(ACTION, args)) == {"error": "sender_only"}
    args["uid"] = user
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    assert await session.scalar(text("select state from public.connections where id=:id"),
                                {"id": pair}) == "canceled"
    replacement = uuid.uuid4()
    await session.execute(text("update public.connections set id=:replacement,state='pending' where id=:id"),
                          {"replacement": replacement, "id": pair})
    assert _json(await session.scalar(ACTION, args)) == {"error": "unavailable"}
    args["id"] = replacement
    args["action"] = "decline"
    assert _json(await session.scalar(ACTION, args)) == {"error": "recipient_only"}
    args["uid"] = peer
    assert _json(await session.scalar(ACTION, args)) == {"ok": True}
    args["action"] = "garbage"
    assert _json(await session.scalar(ACTION, args)) == {"error": "invalid"}
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_connection_action(uuid,uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connection_action(uuid,uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
