"""The Edge correction request preserves FastAPI's durable job and receipt."""

import json
import uuid

import pytest
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text

from app.schemas.editorial_content import VersionCommand
from app.services import editorial_generation, editorial_workflow
from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_revision_generation_matches_existing_receipt_and_source_token(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    submitted, _ = await content.act(api, rid, "submit")
    assert submitted.status_code == 200, submitted.text
    changed, _ = await content.act(api, rid, "changes_requested")
    assert changed.status_code == 200, changed.text
    await session.commit()
    command = VersionCommand.model_validate({
        "request_id": str(uuid.uuid4()),
        "note": "Generate one correction from the authenticated review.",
        "expected_token": changed.json()["token"],
    })
    dump = command.model_dump(mode="json")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "rid": rid, "req": command.request_id, "note": command.note,
            "token": command.expected_token, "enabled": True, "limit": 25,
            "fp": editorial_workflow.digest({
                "resource": f"ai-revision:{rid}", "command": dump})}
    query = text("""select public.edge_api_editorial_revision_generation(
      :uid,:sid,:aal,:rid,:req,:note,:token,:enabled,:limit,:fp)""")
    assert _json(await session.scalar(query, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    assert _json(await session.scalar(query, {**args, "token": "f" * 64}))[
        "error"] == "stale_revision"
    result = _json(await session.scalar(query, args))
    assert result["status"] == "pending" and len(result["token"]) == 64
    job = await editorial_generation.get_job(session, result["id"])
    assert result == jsonable_encoder(editorial_generation.visible(job))
    source = await content.detail(api, rid)
    assert source["token"] == command.expected_token
    await session.commit()
    replay = await api.client.post(
        f"{content.ROOT}/revisions/{rid}/generation-requests",
        headers=api.headers(), json=dump)
    assert replay.status_code == 202, replay.text
    assert replay.json() == result
    assert _json(await session.scalar(query, args)) == result
    assert _json(await session.scalar(query, {**args, "fp": "f" * 64}))[
        "error"] == "receipt_conflict"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_revision_generation(uuid,uuid,text,uuid,uuid,text,text,boolean,integer,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_revision_generation(uuid,uuid,text,uuid,uuid,text,text,boolean,integer,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
