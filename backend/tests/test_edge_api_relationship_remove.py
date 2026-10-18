"""Directed relationship removal respects ownership and stays idempotent."""

import json
import uuid

import pytest
from sqlalchemy import text


REMOVE = text("select public.edge_api_relationship_remove(:uid,:id)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_directed_remove_is_owner_only_and_idempotent(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    relationship = await session.scalar(text("""insert into public.profile_connections
      (source_user_id,target_user_id) values (:actor,:peer) returning id"""),
      {"actor": user, "peer": peer})
    assert _json(await session.scalar(REMOVE, {"uid": peer, "id": relationship})) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.profile_connections where id=:id"),
                                {"id": relationship}) == 1
    assert _json(await session.scalar(REMOVE, {"uid": user, "id": relationship})) == {"ok": True}
    assert _json(await session.scalar(REMOVE, {"uid": user, "id": relationship})) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.profile_connections where id=:id"),
                                {"id": relationship}) == 0
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_relationship_remove(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_relationship_remove(uuid,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
