"""Batch creation preserves the existing atomic discovery and receipt contract."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.services import editorial_workflow as workflow
from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_legacy_batch_create_discovers_once_and_replays_fastapi(api, session, draft):
    topic, subtopic = (await session.execute(text("""select topic_id,subtopic_id
      from public.concepts where id=:id"""), {"id": draft[1]})).one()
    concept = uuid.uuid4()
    await session.execute(text("""insert into public.concepts
      (id,topic_id,subtopic_id,slug,title,summary,status)
      values(:id,:topic,:subtopic,:slug,'Legacy Lesson','Legacy summary','published')"""),
      {"id": concept, "topic": topic, "subtopic": subtopic,
       "slug": f"legacy-create-{concept}"})
    await session.commit()
    command = {"request_id": str(uuid.uuid4()),
               "note": "Create the complete legacy batch.",
               "topic_id": str(topic), "name": f"legacy-{uuid.uuid4().hex}",
               "quota_limit": 2}
    fingerprint = workflow.digest({"resource": f"legacy-batch:{command['name']}",
                                   "command": command})
    sql = text("""select public.edge_api_editorial_create_legacy_batch(
      :uid,:sid,:aal,:topic,:request,:note,:name,:quota,:model,:configured,:fingerprint)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "topic": topic,
            "request": uuid.UUID(command["request_id"]), "note": command["note"],
            "name": command["name"], "quota": command["quota_limit"],
            "model": "gemini-3.1-flash-lite", "configured": True,
            "fingerprint": fingerprint}
    assert _json(await session.scalar(sql, {**args, "aal": "aal1"}))[
        "error"] == "mfa_required"
    assert _json(await session.scalar(sql, {**args, "quota": 0}))[
        "error"] == "invalid"
    result = _json(await session.scalar(sql, args))
    assert result["status"] == "queued"
    assert result["discovered_count"] == 1
    assert result["counts"] == {"queued": 1}
    await session.commit()
    replay = await api.client.post(f"{content.ROOT}/legacy-enrichment-batches",
                                   headers=api.headers(), json=command)
    assert replay.status_code == 201, replay.text
    assert replay.json() == result
    entry = (await session.execute(text("""select concept_id,source_body->>'slug',
      source_body->>'subtopic_slug' from public.editorial_legacy_batch_entries
      where batch_id=:id"""), {"id": uuid.UUID(result["id"])})).one()
    assert entry[0] == concept
    assert entry[1] is None
    assert entry[2]
    assert _json(await session.scalar(sql, args)) == result
    assert _json(await session.scalar(sql, {**args, "fingerprint": "f" * 64}))[
        "error"] == "receipt_conflict"
    await session.commit()
    assert _json(await session.scalar(sql, {**args, "request": uuid.uuid4()}))[
        "error"] == "review_conflict"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_create_legacy_batch(uuid,uuid,text,uuid,uuid,text,text,integer,text,boolean,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_create_legacy_batch(uuid,uuid,text,uuid,uuid,text,text,integer,text,boolean,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
