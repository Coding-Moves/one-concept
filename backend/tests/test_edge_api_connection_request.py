"""Connection invitations retain pair idempotence, privacy, and limits."""

import json
import uuid

import pytest
from sqlalchemy import text


REQUEST = text("select public.edge_api_connection_request(:uid,:token)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_connection_request_pair_lifecycle(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    for uid in (user, peer):
        await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": uid})
    tokens = dict((await session.execute(text(
        "select user_id,public_token from public.profile_sharing where user_id in (:actor,:peer)"),
        {"actor": user, "peer": peer})).all())
    await session.execute(text("update public.profile_sharing set enabled=true where user_id in (:actor,:peer)"),
                          {"actor": user, "peer": peer})
    await session.execute(text("insert into public.connection_preferences(user_id,accepting_requests) values (:uid,true)"),
                          {"uid": peer})
    args = {"uid": user, "token": tokens[peer]}
    first = _json(await session.scalar(REQUEST, args))
    assert first["state"] == "outgoing" and first["retry_after"] is None
    assert _json(await session.scalar(REQUEST, args)) == first
    count = await session.scalar(text("select count(*) from public.connection_request_events where user_id=:uid"),
                                 {"uid": user})
    assert count == 1
    assert _json(await session.scalar(REQUEST, {"uid": peer, "token": tokens[user]})) == {
        "error": "incoming"}
    await session.execute(text("update public.connections set state='accepted' where id=:id"),
                          {"id": first["id"]})
    accepted = _json(await session.scalar(REQUEST, args))
    assert accepted["state"] == "accepted" and accepted["id"] == first["id"]
    await session.execute(text("update public.connections set state='removed',changed_at=now() where id=:id"),
                          {"id": first["id"]})
    cooldown = _json(await session.scalar(REQUEST, args))
    assert cooldown["error"] == "cooldown" and 0 < cooldown["retry_after"] <= 604800
    await session.execute(text("update public.connections set changed_at=now()-interval '8 days' where id=:id"),
                          {"id": first["id"]})
    second = _json(await session.scalar(REQUEST, args))
    assert second["state"] == "outgoing" and second["id"] != first["id"]
    count = await session.scalar(text("select count(*) from public.connection_request_events where user_id=:uid"),
                                 {"uid": user})
    assert count == 2
    await session.execute(text("insert into public.connection_blocks(owner_id,target_id) values (:peer,:actor)"),
                          {"peer": peer, "actor": user})
    assert _json(await session.scalar(REQUEST, args)) == {"error": "unavailable"}


@pytest.mark.asyncio
async def test_connection_request_rejects_private_self_and_rate_limited(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    for uid in (user, peer):
        await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": uid})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    assert _json(await session.scalar(REQUEST, {"uid": user, "token": token})) == {
        "error": "unavailable"}
    await session.execute(text("update public.profile_sharing set enabled=true where user_id in (:actor,:peer)"),
                          {"actor": user, "peer": peer})
    assert _json(await session.scalar(REQUEST, {"uid": peer, "token": token})) == {"error": "self"}
    assert _json(await session.scalar(REQUEST, {"uid": user, "token": token})) == {
        "error": "unavailable"}
    await session.execute(text("insert into public.connection_preferences(user_id,accepting_requests) values (:uid,true)"),
                          {"uid": peer})
    await session.execute(text("insert into public.connection_request_events(user_id) select :uid from generate_series(1,20)"),
                          {"uid": user})
    assert _json(await session.scalar(REQUEST, {"uid": user, "token": token})) == {
        "error": "limit", "retry_after": 86400}
    assert _json(await session.scalar(REQUEST, {"uid": user, "token": "bad"})) == {
        "error": "unavailable"}
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_connection_request(uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connection_request(uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
