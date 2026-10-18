"""Private taxonomy pages honor any read capability and session policy."""

import json
import uuid

import pytest
from sqlalchemy import text


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_taxonomy_paginates_and_enforces_read_authority(session, user):
    sid = uuid.uuid4()
    topic = uuid.uuid4()
    first = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff0")
    second = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff1")
    args = {"uid": user, "sid": sid, "aal": "aal2",
            "cursor": uuid.UUID("ffffffff-ffff-4fff-bfff-ffffffffffef"), "limit": 1}
    page = text("select public.edge_api_editorial_taxonomy(:uid,:sid,:aal,:cursor,:limit)")
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), args)
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"), args)
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,'editor@example.invalid',array['approve'],'Editor Name','Editor Name')"""), args)
    await session.execute(text("""insert into public.topics(id,slug,name,is_active)
      values(:id,:slug,'Software',false)"""), {"id": topic, "slug": f"taxonomy-{topic}"})
    for subtopic_id, name in ((first, "Core"), (second, "Advanced")):
        await session.execute(text("""insert into public.subtopics(id,topic_id,slug,name)
          values(:id,:topic,:slug,:name)"""),
          {"id": subtopic_id, "topic": topic, "slug": f"tax-{subtopic_id}", "name": name})

    result = _json(await session.scalar(page, args))
    assert result["items"] == [{
        "id": str(first), "name": "Core", "is_active": True,
        "topic_id": str(topic), "topic_name": "Software", "topic_active": False,
    }]
    assert result["next_cursor"] == str(first)
    args["cursor"] = first
    last = _json(await session.scalar(page, args))
    assert last["items"][0]["id"] == str(second)
    assert last["next_cursor"] is None
    args["cursor"] = None
    args["limit"] = 101
    assert _json(await session.scalar(page, args))["error"] == "invalid_page"
    args["limit"] = 1
    args["aal"] = "aal1"
    assert _json(await session.scalar(page, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(page, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['publish'],approved_name=null where user_id=:uid"""), args)
    assert _json(await session.scalar(page, args))["error"] == "profile_required"
    await session.execute(text("""update public.editorial_memberships
      set approved_name='Editor Name' where user_id=:uid"""), args)
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("grant select on public.topics, public.subtopics to service_role"))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(page, args))["items"]
    await session.execute(text("reset role"))
    await session.execute(text("delete from auth.sessions where id=:sid"), args)
    assert _json(await session.scalar(page, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_taxonomy(uuid,uuid,text,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_taxonomy(uuid,uuid,text,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
