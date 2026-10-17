"""Legacy batch summaries preserve FastAPI's visible fields and version token."""

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
async def test_editorial_legacy_batches_match_backend_and_role_gate(api, session, draft):
    topic = await session.scalar(text("select topic_id from public.concepts where id=:id"),
                                 {"id": draft[1]})
    batch_id = uuid.uuid4()
    entry_id = uuid.uuid4()
    await session.execute(text("""insert into public.editorial_legacy_batches
      (id,topic_id,name,requested_by,model,prompt_version,status,
       discovered_count,quota_limit,started_at,finished_at)
      values(:id,:topic,:name,:actor,'gemini-3','v1','completed',1,2,
       '2026-10-17 08:00:00.123456+00'::timestamptz,
       '2026-10-17 08:00:01.123456+00'::timestamptz)"""),
      {"id": batch_id, "topic": topic, "name": f"legacy-{batch_id}",
       "actor": api.owner.id})
    await session.execute(text("""insert into public.editorial_legacy_batch_entries
      (id,batch_id,concept_id,base_version,source_body,status)
      values(:id,:batch,:concept,1,'{}'::jsonb,'skipped')"""),
      {"id": entry_id, "batch": batch_id, "concept": draft[1]})
    await session.commit()
    read = text("""select public.edge_api_editorial_legacy_batches(
      :uid,:sid,:aal,:topic)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "topic": topic}
    expected = await api.client.get(f"{content.ROOT}/legacy-enrichment-batches",
                                    params={"topic_id": str(topic)}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(read, args))
    assert result == expected.json()
    item = next(item for item in result["items"] if item["id"] == str(batch_id))
    assert item["counts"] == {"skipped": 1}
    assert len(item["token"]) == 64
    args["topic"] = uuid.uuid4()
    assert _json(await session.scalar(read, args))["items"] == []
    args["topic"] = topic
    args["aal"] = "aal1"
    assert _json(await session.scalar(read, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['approve'] where user_id=:uid"""), args)
    assert _json(await session.scalar(read, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("""grant select on public.editorial_legacy_batches,
      public.editorial_legacy_batch_entries,public.concept_revisions to service_role"""))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(read, args))["items"]
    await session.execute(text("reset role"))
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_legacy_batches(uuid,uuid,text,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_legacy_batches(uuid,uuid,text,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
