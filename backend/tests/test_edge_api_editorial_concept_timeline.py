"""Editorial concept evidence pages preserve the FastAPI cursor and authority."""

import base64
import json
import uuid
from datetime import datetime

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_concept_timeline_matches_backend_and_paginates(api, session, draft):
    topic = await session.scalar(text("select topic_id from public.concepts where id=:id"),
                                 {"id": draft[1]})
    event_ids = [uuid.uuid4(), uuid.uuid4()]
    for n, event_id in enumerate(event_ids):
        await session.execute(text("""insert into public.editorial_workflow_events
          (id,concept_id,topic_id,actor_id,registered_name,action,note,details,created_at)
          values(:id,:concept,:topic,:actor,'Initial Owner','comment',
            'Reviewed this lesson in staging.','{}'::jsonb,
            '2026-10-17 08:00:00.123456+00'::timestamptz +
              make_interval(secs=>:offset))"""),
          {"id": event_id, "concept": draft[1], "topic": topic,
           "actor": api.owner.id, "offset": n})
    await session.commit()
    read = text("""select public.edge_api_editorial_concept_timeline(
      :uid,:sid,:aal,:concept,:after_at,:after_key,:limit)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "concept": draft[1], "after_at": None, "after_key": None, "limit": 1}
    base = f"{content.ROOT}/concepts/{draft[1]}/timeline"
    expected = await api.client.get(base, params={"limit": 1}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    first = _json(await session.scalar(read, args))
    assert first == expected.json()
    assert first["next_cursor"]
    raw = base64.urlsafe_b64decode(first["next_cursor"] + "=" * (-len(first["next_cursor"]) % 4))
    after_at, args["after_key"] = json.loads(raw)
    args["after_at"] = datetime.fromisoformat(after_at)
    following = await api.client.get(base, params={"limit": 1, "cursor": first["next_cursor"]},
                                     headers=api.headers())
    assert following.status_code == 200, following.text
    assert _json(await session.scalar(read, args)) == following.json()
    args["concept"] = uuid.uuid4()
    assert _json(await session.scalar(read, args))["error"] == "concept_not_found"
    args["concept"] = draft[1]
    args["limit"] = 101
    assert _json(await session.scalar(read, args))["error"] == "invalid_page"
    args["limit"] = 1
    args["aal"] = "aal1"
    assert _json(await session.scalar(read, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(read, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("""grant select on public.concepts,
      public.editorial_revision_events,public.editorial_workflow_events
      to service_role"""))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(read, args))["items"]
    await session.execute(text("reset role"))
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_concept_timeline(uuid,uuid,text,uuid,timestamp with time zone,text,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_concept_timeline(uuid,uuid,text,uuid,timestamp with time zone,text,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
