"""Block by owned relationship ID works after sharing is disabled."""

import json
import uuid

import pytest
from sqlalchemy import text


BLOCK = text("select public.edge_api_relationship_block(:uid,:id)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_directed_block_is_owner_only_and_removes_both_models(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    relationship = await session.scalar(text("""insert into public.profile_connections
      (source_user_id,target_user_id) values (:actor,:peer) returning id"""),
      {"actor": user, "peer": peer})
    await session.execute(text("""insert into public.profile_connections
      (source_user_id,target_user_id) values (:peer,:actor)"""),
      {"actor": user, "peer": peer})
    await session.execute(text("""insert into public.connections
      (low_user,high_user,initiator,state) values (:low,:high,:actor,'accepted')"""),
      {"low": min(user, peer), "high": max(user, peer), "actor": user})
    args = {"uid": user, "id": relationship}
    assert _json(await session.scalar(BLOCK, {"uid": peer, "id": relationship})) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.connection_blocks where owner_id=:uid"),
                                {"uid": peer}) == 0
    assert _json(await session.scalar(BLOCK, args)) == {"ok": True}
    assert _json(await session.scalar(BLOCK, args)) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.connection_blocks where owner_id=:uid"),
                                {"uid": user}) == 1
    assert await session.scalar(text("select count(*) from public.profile_connections where source_user_id in (:actor,:peer)"),
                                {"actor": user, "peer": peer}) == 0
    assert await session.scalar(text("select count(*) from public.connections where low_user=:low and high_user=:high"),
                                {"low": min(user, peer), "high": max(user, peer)}) == 0
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_relationship_block(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_relationship_block(uuid,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
