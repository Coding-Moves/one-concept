"""Legacy batch transitions keep FastAPI's receipt and entry-state contract."""

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
async def test_legacy_batch_actions_match_fastapi_replay_and_audit(api, session, draft):
    topic = await session.scalar(text("select topic_id from public.concepts where id=:id"),
                                 {"id": draft[1]})
    batch_id, entry_id = uuid.uuid4(), uuid.uuid4()
    await session.execute(text("""insert into public.editorial_legacy_batches
      (id,topic_id,name,requested_by,model,prompt_version,status,
       discovered_count,quota_limit)
      values(:id,:topic,:name,:actor,'gemini-3','v1','queued',1,2)"""),
      {"id": batch_id, "topic": topic, "name": f"legacy-{batch_id}",
       "actor": api.owner.id})
    await session.execute(text("""insert into public.editorial_legacy_batch_entries
      (id,batch_id,concept_id,base_version,source_body,status)
      values(:id,:batch,:concept,1,'{}'::jsonb,'queued')"""),
      {"id": entry_id, "batch": batch_id, "concept": draft[1]})
    await session.commit()
    sql = text("""select public.edge_api_editorial_legacy_batch_action(
      :uid,:sid,:aal,:batch,:request,:note,:token,:action,:fingerprint)""")
    base = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "batch": batch_id}
    visible = _json(await session.scalar(text("""select
      public.edge_api_editorial_legacy_batch_public(b)
      from public.editorial_legacy_batches b where id=:id"""), {"id": batch_id}))

    async def act(action, token):
        command = {"request_id": str(uuid.uuid4()), "note": "Document this batch transition.",
                   "expected_token": token, "action": action}
        fingerprint = workflow.digest({"resource": f"legacy-batch-action:{batch_id}",
                                       "command": command})
        args = {**base, "request": uuid.UUID(command["request_id"]),
                "note": command["note"], "token": token,
                "action": action, "fingerprint": fingerprint}
        result = _json(await session.scalar(sql, args))
        await session.commit()
        replay = await api.client.post(
            f"{content.ROOT}/legacy-enrichment-batches/{batch_id}/actions",
            headers=api.headers(), json=command)
        assert replay.status_code == 200, replay.text
        assert replay.json() == result
        return result, args

    pause_args = {**base, "request": uuid.uuid4(), "note": "Document this batch transition.",
                  "token": visible["token"], "action": "pause", "fingerprint": "f" * 64}
    assert _json(await session.scalar(sql, {**pause_args, "aal": "aal1"}))[
        "error"] == "mfa_required"
    assert _json(await session.scalar(sql, {**pause_args, "token": "0" * 64}))[
        "error"] == "stale_revision"
    await session.commit()
    paused, args = await act("pause", visible["token"])
    assert paused["status"] == "paused" and paused["counts"] == {"queued": 1}
    assert _json(await session.scalar(sql, args)) == paused
    await session.commit()
    cancelled, _ = await act("cancel", paused["token"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["counts"] == {"skipped": 1}
    entry = (await session.execute(text("""select status,failure_code
      from public.editorial_legacy_batch_entries where id=:id"""),
      {"id": entry_id})).one()
    assert entry == ("skipped", "batch_cancelled")
    events = await session.scalar(text("""select count(*) from public.editorial_workflow_events
      where details->>'batch_id'=:id and action='comment'"""), {"id": str(batch_id)})
    assert events == 2
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_legacy_batch_action(uuid,uuid,text,uuid,uuid,text,text,text,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_legacy_batch_action(uuid,uuid,text,uuid,uuid,text,text,text,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
