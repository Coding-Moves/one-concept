"""Cancellation preserves the FastAPI job token, receipt, and audit contract."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.services import editorial_workflow as workflow
from tests import test_editorial_generation as generation


api = generation.api
draft = generation.draft
queued = generation.queued
editorial = generation.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_cancel_job_matches_fastapi_replay_and_guards(api, session, queued):
    job, _, _, _, _ = queued
    job_id = uuid.UUID(job["id"])
    command = {"request_id": str(uuid.uuid4()), "note": "Please cancel this pending job.",
               "expected_token": job["token"]}
    fingerprint = workflow.digest({"resource": f"cancel-generation:{job_id}",
                                   "command": command})
    sql = text("""select public.edge_api_editorial_cancel_generation_job(
      :uid,:sid,:aal,:job,:request,:note,:token,:fingerprint)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "job": job_id,
            "request": uuid.UUID(command["request_id"]), "note": command["note"],
            "token": command["expected_token"], "fingerprint": fingerprint}
    assert _json(await session.scalar(sql, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    assert _json(await session.scalar(sql, {**args, "request": uuid.uuid4(),
        "token": "0" * 64}))["error"] == "stale_revision"
    assert _json(await session.scalar(sql, {**args, "request": uuid.uuid4(),
        "note": "\t" * 10}))["error"] == "review_conflict"
    result = _json(await session.scalar(sql, args))
    assert result["status"] == "cancelled"
    await session.commit()
    expected = await api.client.post(
        f"{generation.ROOT}/generation-jobs/{job_id}/cancel",
        headers=api.headers(), json=command)
    assert expected.status_code == 200, expected.text
    assert result == expected.json()
    assert _json(await session.scalar(sql, args)) == result
    assert _json(await session.scalar(sql, {**args, "fingerprint": "f" * 64}))[
        "error"] == "receipt_conflict"
    # The SQL retry acquired the account advisory lock in this session. Release
    # it before the FastAPI request uses a separate database connection.
    await session.commit()
    changed = await api.client.post(
        f"{generation.ROOT}/generation-jobs/{job_id}/cancel",
        headers=api.headers(), json={**command, "note": "A different cancellation reason."})
    assert changed.status_code == 409
    events = await session.scalar(text("""select count(*) from public.editorial_workflow_events
      where details->>'generation_job_id'=:job and details->>'generation_status'='cancelled'"""),
      {"job": str(job_id)})
    assert events == 1
    privileges = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_cancel_generation_job(uuid,uuid,text,uuid,uuid,text,text,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_cancel_generation_job(uuid,uuid,text,uuid,uuid,text,text,text)', 'EXECUTE')"""))).one()
    assert privileges == (False, True)
