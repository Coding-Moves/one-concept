"""Owner activity pages remain session-bound and filter by topic."""

import json
import uuid

import pytest
from sqlalchemy import text


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_activity_filters_and_enforces_owner_access(session, user):
    sid = uuid.uuid4()
    topic = uuid.uuid4()
    other_topic = uuid.uuid4()
    first = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff0")
    second = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff1")
    third = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff2")
    args = {"uid": user, "sid": sid, "aal": "aal2",
            "cursor": None, "topic": topic, "limit": 1}
    page = text("select public.edge_api_editorial_activity(:uid,:sid,:aal,:cursor,:topic,:limit)")
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), args)
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"), args)
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,'owner@example.invalid',array['manage_reviewers'],'Owner Name','Owner Name')"""), args)
    for topic_id in (topic, other_topic):
        await session.execute(text("""insert into public.topics(id,slug,name)
          values(:id,:slug,'Activity Topic')"""),
          {"id": topic_id, "slug": f"activity-{topic_id}"})
    for event_id, event_topic in ((first, topic), (second, topic), (third, other_topic)):
        await session.execute(text("""insert into public.editorial_workflow_events
          (id,topic_id,actor_id,registered_name,action,note,details)
          values(:id,:topic,:uid,'Owner Name','comment','A review note.',
            '{"source":"test"}'::jsonb)"""),
          {"id": event_id, "topic": event_topic, "uid": user})

    result = _json(await session.scalar(page, args))
    assert result["items"][0]["id"] == str(first)
    assert result["items"][0]["details"] == {"source": "test"}
    assert result["next_cursor"] == str(first)
    args["cursor"] = first
    last = _json(await session.scalar(page, args))
    assert last["items"][0]["id"] == str(second)
    assert last["next_cursor"] is None
    args["cursor"] = None
    args["topic"] = uuid.uuid4()
    assert _json(await session.scalar(page, args)) == {"items": [], "next_cursor": None}
    args["topic"] = topic
    args["limit"] = 0
    assert _json(await session.scalar(page, args))["error"] == "invalid_page"
    args["limit"] = 1
    args["aal"] = "aal1"
    assert _json(await session.scalar(page, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(page, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'],approved_name=null where user_id=:uid"""), args)
    assert _json(await session.scalar(page, args))["error"] == "profile_required"
    await session.execute(text("""update public.editorial_memberships
      set approved_name='Owner Name' where user_id=:uid"""), args)
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("""grant select on public.editorial_workflow_events
      to service_role"""))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(page, args))["items"][0]["id"] == str(first)
    await session.execute(text("reset role"))
    await session.execute(text("delete from auth.sessions where id=:sid"), args)
    assert _json(await session.scalar(page, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_activity(uuid,uuid,text,uuid,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_activity(uuid,uuid,text,uuid,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
