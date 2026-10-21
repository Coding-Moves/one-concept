"""Versioned reviewer access enforces last-administrator and audit rules."""

import json

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content
from tests.test_editorial_api import enroll


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_reviewer_access_versions_audit_and_last_admin(api, session):
    reviewer, _, member = await enroll(api, session)
    command = text("""select public.edge_api_editorial_reviewer_access(
      :uid,:sid,:aal,:subject,:version,:status,:caps)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "subject": reviewer,
            "version": member["version"], "status": "revoked", "caps": ["review"]}
    result = _json(await session.scalar(command, args))
    assert result["user_id"] == str(reviewer)
    assert result["status"] == "revoked"
    assert result["version"] == member["version"] + 1
    assert result["capabilities"] == ["review"]
    await session.commit()
    saved = await api.client.get(f"{content.ROOT}/reviewers", headers=api.headers())
    assert saved.status_code == 200, saved.text
    assert next(item for item in saved.json()["items"]
                if item["user_id"] == str(reviewer))["status"] == "revoked"
    assert _json(await session.scalar(command, args))["error"] == "version_conflict"
    args["version"] = result["version"]
    assert _json(await session.scalar(command, args)) == result
    audit = (await session.execute(text("""select details from public.editorial_account_events
      where subject_id=:subject and action='access_changed'"""), args)).scalars().all()
    assert len(audit) == 1 and audit[0]["version"] == result["version"]
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    args["subject"] = api.owner.id
    args["version"] = (await session.scalar(text("""select version
      from public.editorial_memberships where user_id=:subject"""), args))
    args["caps"] = []
    assert _json(await session.scalar(command, args))["error"] == "last_admin"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_reviewer_access(uuid,uuid,text,uuid,integer,text,text[])', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_reviewer_access(uuid,uuid,text,uuid,integer,text,text[])', 'EXECUTE')"""))).one()
    assert rights == (False, True)
    await session.execute(text("delete from public.editorial_account_events where subject_id=:uid"),
                          {"uid": reviewer})
    await session.execute(text("delete from auth.users where id=:uid"), {"uid": reviewer})
    await session.commit()
