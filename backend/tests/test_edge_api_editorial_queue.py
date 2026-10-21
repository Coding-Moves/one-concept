"""The candidate queue matches the private FastAPI read model and policy."""

import json
import uuid

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_queue_matches_existing_views_and_rechecks_authority(api, session, draft):
    command = text("""select public.edge_api_editorial_queue(
      :uid,:sid,:aal,:kind,:status,:topic,:assignee,:subtopic,:urgency,:search,:cursor,:limit)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "kind": "revisions", "status": None, "topic": None, "assignee": None,
            "subtopic": None, "urgency": None, "search": "", "cursor": None, "limit": 25}
    for kind in ("revisions", "legacy", "published"):
        args["kind"] = kind
        expected = await api.client.get(f"{content.ROOT}/queue", headers=api.headers(),
                                        params={"kind": kind})
        assert expected.status_code == 200, expected.text
        assert _json(await session.scalar(command, args)) == expected.json()
    topic = await session.scalar(text("select topic_id from public.concepts where id=:id"),
                                 {"id": draft[1]})
    legacy_id = uuid.uuid4()
    args.update({"kind": "legacy", "topic": topic})
    await session.execute(text("""insert into public.concepts
      (id,topic_id,slug,title,summary,status)
      values(:id,:topic,:slug,'Legacy Queue Lesson','Queue summary','published')"""),
      {"id": legacy_id, "topic": topic, "slug": f"legacy-queue-{legacy_id}"})
    await session.execute(text("""insert into public.editorial_legacy_versions
      (concept_id,content_version,snapshot)
      select id,content_version,to_jsonb(c)-array['created_at','published_at','status']
      from public.concepts c where id=:id"""), {"id": legacy_id})
    legacy = _json(await session.scalar(command, args))
    assert legacy["total"] == 1
    assert legacy["items"][0]["id"] == str(legacy_id)
    assert legacy["items"][0]["unchanged"] is True
    approval = uuid.uuid4()
    await session.execute(text("""insert into public.editorial_revision_events
      (id,concept_id,base_version,actor_id,registered_name,action,
       revision_body,source_snapshot,note,checklist_version,quality_review)
      select :event,id,content_version,:actor,'Initial Owner','attested',
        '{}'::jsonb,to_jsonb(c)-array['created_at','published_at','status'],
        'Attested legacy lesson.',1,'{}'::jsonb
      from public.concepts c where id=:id"""),
      {"event": approval, "actor": api.owner.id, "id": legacy_id})
    await session.execute(text("""insert into public.editorial_publications
      (concept_id,content_version,approval_id,snapshot)
      select id,content_version,:event,to_jsonb(c)-array['created_at','published_at','status']
      from public.concepts c where id=:id"""),
      {"event": approval, "id": legacy_id})
    assert _json(await session.scalar(command, args))["items"] == []
    args["kind"] = "published"
    published = _json(await session.scalar(command, args))
    assert published["total"] == 1
    assert published["items"][0]["id"] == str(legacy_id)
    assert published["items"][0]["approved_by"] == "Initial Owner"
    assert published["items"][0]["verified"] is True
    args["kind"] = "revisions"
    args["topic"] = None
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("grant select on all tables in schema public to service_role"))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(command, args))["total"] >= 1
    await session.execute(text("reset role"))
    args["search"] = draft[0]
    args["limit"] = 1
    expected = await api.client.get(f"{content.ROOT}/queue", headers=api.headers(),
                                    params={"search": draft[0], "limit": 1})
    assert _json(await session.scalar(command, args)) == expected.json()
    args["kind"] = "legacy"
    args["status"] = "draft"
    assert _json(await session.scalar(command, args))["error"] == "invalid_filter"
    args["kind"] = "revisions"
    args["status"] = None
    args["limit"] = 101
    assert _json(await session.scalar(command, args))["error"] == "invalid_page"
    args["limit"] = 25
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    args["cursor"] = uuid.uuid4()
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_queue(uuid,uuid,text,text,text,uuid,uuid,uuid,text,text,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_queue(uuid,uuid,text,text,text,uuid,uuid,uuid,text,text,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
