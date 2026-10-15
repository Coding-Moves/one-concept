"""Blocking by a visible token removes both relationship models."""

import json
import uuid

import pytest
from sqlalchemy import text


BLOCK = text("select public.edge_api_connection_block_token(:uid,:token)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_block_token_clears_legacy_and_both_directed_rows(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    await session.execute(text("update public.profile_sharing set enabled=true where user_id=:uid"),
                          {"uid": peer})
    await session.execute(text("""insert into public.connections(low_user,high_user,initiator,state)
      values (:low,:high,:actor,'accepted')"""),
      {"low": min(user, peer), "high": max(user, peer), "actor": user})
    await session.execute(text("""insert into public.profile_connections(source_user_id,target_user_id)
      values (:actor,:peer),(:peer,:actor)"""), {"actor": user, "peer": peer})
    assert _json(await session.scalar(BLOCK, {"uid": user, "token": token})) == {"ok": True}
    state = await session.scalar(text("""select state from public.connections
      where low_user=:low and high_user=:high"""),
      {"low": min(user, peer), "high": max(user, peer)})
    assert state == "removed"
    assert await session.scalar(text("select count(*) from public.profile_connections")) == 0
    assert await session.scalar(text("select count(*) from public.connection_blocks where owner_id=:uid"),
                                {"uid": user}) == 1
    assert _json(await session.scalar(BLOCK, {"uid": user, "token": token})) == {
        "error": "unavailable"}
    assert _json(await session.scalar(BLOCK, {"uid": peer, "token": token})) == {"error": "self"}


@pytest.mark.asyncio
async def test_block_token_rejects_revoked_private_and_missing_profiles(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": peer})
    assert _json(await session.scalar(BLOCK, {"uid": user, "token": token})) == {
        "error": "unavailable"}
    await session.execute(text("update public.profile_sharing set enabled=true where user_id=:uid"),
                          {"uid": peer})
    assert await session.scalar(BLOCK, {"uid": uuid.uuid4(), "token": token}) is None
    assert _json(await session.scalar(BLOCK, {"uid": user, "token": "bad"})) == {
        "error": "unavailable"}
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_connection_block_token(uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connection_block_token(uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
