"""Directed pages honor owner, current sharing, blocks, and stable cursors."""

import json
import uuid
from datetime import datetime

import pytest
from sqlalchemy import text


LIST = text("select public.edge_api_relationships(:uid,:created,:id,:limit)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_directed_list_privacy_avatar_handoff_and_cursor(session, user):
    old_peer, new_peer = uuid.uuid4(), uuid.uuid4()
    for peer in (old_peer, new_peer):
        await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                              {"uid": peer, "email": f"{peer}@example.invalid"})
        await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": peer})
    await session.execute(text("""update public.profile_sharing set enabled=true,
      show_name=true,show_avatar=true where user_id=:uid"""), {"uid": old_peer})
    await session.execute(text("""update public.profile_sharing set enabled=true,
      show_avatar=true where user_id=:uid"""), {"uid": new_peer})
    await session.execute(text("update public.profiles set display_name='Older',avatar_url='preset:aurora' where id=:uid"),
                          {"uid": old_peer})
    photo = f"avatars/{new_peer}/{'a' * 32}.jpg"
    await session.execute(text("update public.profiles set display_name='Hidden',avatar_url=:photo where id=:uid"),
                          {"uid": new_peer, "photo": photo})
    await session.execute(text("""insert into public.profile_connections
      (source_user_id,target_user_id,created_at) values
      (:actor,:old,now()-interval '2 days'),(:actor,:new,now()-interval '1 day')"""),
      {"actor": user, "old": old_peer, "new": new_peer})
    first = _json(await session.scalar(LIST, {"uid": user, "created": None, "id": None, "limit": 1}))
    assert len(first["items"]) == 1 and first["next_cursor"]
    assert first["items"][0]["display_name"] == "Private learner"
    assert first["items"][0]["avatar_key"] == photo
    assert first["items"][0]["avatar_owner"] == str(new_peer)
    created, row_id = first["next_cursor"].rsplit(":", 1)
    second = _json(await session.scalar(LIST, {"uid": user,
                                              "created": datetime.fromisoformat(created.replace("Z", "+00:00")),
                                              "id": uuid.UUID(row_id), "limit": 1}))
    assert second["next_cursor"] is None and len(second["items"]) == 1
    assert second["items"][0]["display_name"] == "Older"
    assert second["items"][0]["avatar_ref"] == "preset:aurora"
    assert second["items"][0]["avatar_key"] is None
    assert second["items"][0]["public_path"].startswith("/p/")
    assert _json(await session.scalar(LIST, {"uid": new_peer, "created": None,
                                          "id": None, "limit": 25}))["items"] == []
    await session.execute(text("update public.profile_sharing set enabled=false where user_id=:uid"),
                          {"uid": new_peer})
    revoked = _json(await session.scalar(LIST, {"uid": user, "created": None,
                                              "id": None, "limit": 25}))["items"][0]
    assert revoked["display_name"] == "Private learner"
    assert revoked["public_path"] is None and revoked["avatar_key"] is None
    await session.execute(text("insert into public.connection_blocks(owner_id,target_id) values (:peer,:actor)"),
                          {"peer": old_peer, "actor": user})
    remaining = _json(await session.scalar(LIST, {"uid": user, "created": None,
                                                "id": None, "limit": 25}))
    assert len(remaining["items"]) == 1


@pytest.mark.asyncio
async def test_directed_list_missing_profile_and_permissions(session, user):
    assert await session.scalar(LIST, {"uid": uuid.uuid4(), "created": None,
                                       "id": None, "limit": 25}) is None
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_relationships(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_relationships(uuid,timestamptz,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
