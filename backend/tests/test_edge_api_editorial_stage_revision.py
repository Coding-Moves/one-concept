"""Versioned staging keeps FastAPI tokens and receipts across the cutover."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.schemas.editorial_content import StageInput
from app.services import editorial_workflow
from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_python_json_canonicalization_is_exact_for_nested_unicode(session):
    value = {"é": ["quoted \" value", "line\nnext", "🐙", {"Ω": "\\"}],
             "number": 3, "bool": True, "empty": None}
    actual = await session.scalar(text("""select public.edge_api_editorial_python_json(
      cast(:value as jsonb))"""), {"value": json.dumps(value)})
    assert actual == json.dumps(value, sort_keys=True, separators=(",", ":"))


@pytest.mark.asyncio
async def test_stage_revision_matches_fastapi_token_and_cross_service_replay(api, session, draft):
    cid = draft[1]
    initial = await api.client.get(f"{content.ROOT}/concepts/{cid}", headers=api.headers())
    assert initial.status_code == 200, initial.text
    old_rid = await content.rid_for(session, cid)
    body = (await content.detail(api, old_rid))["body"]
    command = StageInput.model_validate({
        "request_id": str(uuid.uuid4()),
        "note": "Stage a corrected and reviewed lesson package.",
        "expected_token": initial.json()["token"],
        "body": body | {"title": "A separate reviewed version " + draft[0]},
    })
    dump = command.model_dump(mode="json")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "cid": cid, "req": command.request_id,
            "note": command.note, "token": command.expected_token,
            "body": command.body.model_dump_json(),
            "fp": editorial_workflow.digest({"resource": f"stage:{cid}", "command": dump})}
    query = text("""select public.edge_api_editorial_stage_revision(
      :uid,:sid,:aal,:cid,:req,:note,:token,cast(:body as jsonb),:fp)""")
    assert _json(await session.scalar(query, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    assert _json(await session.scalar(query, {**args, "token": "f" * 64}))[
        "error"] == "stale_revision"
    result = _json(await session.scalar(query, args))
    assert result["status"] == "draft" and len(result["token"]) == 64
    await session.commit()
    preview = await api.client.get(
        f"{content.ROOT}/revisions/{result['revision_id']}", headers=api.headers())
    assert preview.status_code == 200, preview.text
    assert result["token"] == preview.json()["token"]
    replay = await api.client.post(
        f"{content.ROOT}/concepts/{cid}/revisions",
        headers=api.headers(), json=dump)
    assert replay.status_code == 201, replay.text
    assert replay.json() == result
    assert _json(await session.scalar(query, args)) == result
    assert _json(await session.scalar(query, {**args, "fp": "f" * 64}))[
        "error"] == "receipt_conflict"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_python_json(jsonb)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_python_json(jsonb)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.edge_api_editorial_stage_revision(uuid,uuid,text,uuid,uuid,text,text,jsonb,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_stage_revision(uuid,uuid,text,uuid,uuid,text,text,jsonb,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True, False, True)
