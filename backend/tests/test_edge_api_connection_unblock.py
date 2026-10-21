"""Unblocking is owner-bound and idempotent."""

import json
import uuid

import pytest
from sqlalchemy import text


UNBLOCK = text("select public.edge_api_connection_unblock(:uid,:id)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_unblock_is_owner_only_and_idempotent(session, user):
    peer = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": peer, "email": f"{peer}@example.invalid"})
    block = await session.scalar(text("""insert into public.connection_blocks(owner_id,target_id)
      values (:owner,:target) returning id"""), {"owner": user, "target": peer})
    assert _json(await session.scalar(UNBLOCK, {"uid": peer, "id": block})) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.connection_blocks where id=:id"),
                                {"id": block}) == 1
    assert _json(await session.scalar(UNBLOCK, {"uid": user, "id": block})) == {"ok": True}
    assert _json(await session.scalar(UNBLOCK, {"uid": user, "id": block})) == {"ok": True}
    assert await session.scalar(text("select count(*) from public.connection_blocks where id=:id"),
                                {"id": block}) == 0
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_connection_unblock(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connection_unblock(uuid,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
