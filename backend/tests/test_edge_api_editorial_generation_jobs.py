"""Generation job reads preserve the existing visible fields and version token."""

import json
import uuid

import pytest
from sqlalchemy import text

from tests import test_editorial_generation as generation


api = generation.api
draft = generation.draft
editorial = generation.editorial
queued = generation.queued


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_generation_jobs_match_backend_token_and_enforce_access(
    api, session, queued
):
    job, _, _, _, _ = queued
    job_id = uuid.UUID(job["id"])
    list_sql = text("""select public.edge_api_editorial_generation_jobs(
      :uid,:sid,:aal,:status,:topic,:concept,:cursor,:limit)""")
    detail_sql = text("""select public.edge_api_editorial_generation_job(
      :uid,:sid,:aal,:job)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "status": None, "topic": None, "concept": None,
            "cursor": None, "limit": 25, "job": job_id}
    expected_detail = await api.client.get(
        f"{generation.ROOT}/generation-jobs/{job_id}", headers=api.headers())
    assert expected_detail.status_code == 200, expected_detail.text
    assert _json(await session.scalar(detail_sql, args)) == expected_detail.json()
    expected_list = await api.client.get(
        f"{generation.ROOT}/generation-jobs", headers=api.headers())
    assert expected_list.status_code == 200, expected_list.text
    local_list = _json(await session.scalar(list_sql, args))
    assert local_list == expected_list.json()
    assert next(x for x in local_list["items"] if x["id"] == str(job_id))["token"] == job["token"]
    assert "source_body" not in _json(await session.scalar(detail_sql, args))
    stamps = (await session.execute(text("""select
      public.edge_api_editorial_utc_iso('2026-10-17 08:02:32.120000+00'::timestamptz),
      public.edge_api_editorial_utc_iso('2026-10-17 08:02:32+00'::timestamptz)"""))).one()
    assert stamps == ("2026-10-17T08:02:32.120000+00:00", "2026-10-17T08:02:32+00:00")
    args["status"] = "pending"
    args["topic"] = uuid.UUID(job["topic_id"])
    args["concept"] = uuid.UUID(job["concept_id"])
    assert [x["id"] for x in _json(await session.scalar(list_sql, args))["items"]] == [str(job_id)]
    args["job"] = uuid.uuid4()
    assert _json(await session.scalar(detail_sql, args))["error"] == "job_not_found"
    args["job"] = job_id
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("grant select on public.editorial_generation_jobs to service_role"))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(detail_sql, args))["token"] == job["token"]
    await session.execute(text("reset role"))
    args["limit"] = 101
    assert _json(await session.scalar(list_sql, args))["error"] == "invalid_page"
    args["limit"] = 25
    args["aal"] = "aal1"
    assert _json(await session.scalar(detail_sql, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(list_sql, args))["error"] == "permission"
    for signature in (
        "public.edge_api_editorial_generation_jobs(uuid,uuid,text,text,uuid,uuid,uuid,integer)",
        "public.edge_api_editorial_generation_job(uuid,uuid,text,uuid)",
    ):
        rights = (await session.execute(text("""select
          has_function_privilege('authenticated',:signature,'EXECUTE'),
          has_function_privilege('service_role',:signature,'EXECUTE')"""),
          {"signature": signature})).one()
        assert rights == (False, True)
