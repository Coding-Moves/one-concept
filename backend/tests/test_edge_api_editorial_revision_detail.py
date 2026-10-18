"""A private revision source preserves the same token inputs as FastAPI."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.services import editorial_workflow
from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_revision_detail_source_matches_token_and_denies_unapproved_access(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    query = text("""select public.edge_api_editorial_revision_detail_source(
      :uid,:sid,:aal,:rid)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "rid": rid}
    expected = await api.client.get(f"{content.ROOT}/revisions/{rid}", headers=api.headers())
    assert expected.status_code == 200, expected.text
    source = _json(await session.scalar(query, args))
    row = source["revision"]
    assert row["body"] == expected.json()["body"]
    assert source["source_body"] == expected.json()["source_body"]
    token_source = {key: row[key] for key in (
        "id", "concept_id", "base_version", "body", "status", "assigned_to", "review_due_at"
    )} | {key: source[key] for key in (
        "source_snapshot", "concept_status", "topic_active", "subtopic_active", "subtopic_slug"
    )}
    assert editorial_workflow.digest(token_source) == expected.json()["token"]
    await session.execute(text("""update public.concept_revisions
      set review_due_at='2026-10-17T09:10:11.123456+00:00' where id=:rid"""), args)
    await session.commit()
    dated = await api.client.get(f"{content.ROOT}/revisions/{rid}", headers=api.headers())
    assert dated.status_code == 200, dated.text
    dated_source = _json(await session.scalar(query, args))
    assert dated_source["revision"]["review_due_at"] == dated.json()["review_due_at"]
    dated_token = token_source | {"review_due_at": dated_source["revision"]["review_due_at"]}
    assert editorial_workflow.digest(dated_token) == dated.json()["token"]
    assert _json(await session.scalar(query, {**args, "rid": uuid.uuid4()})) == {
        "error": "revision_not_found"
    }
    assert _json(await session.scalar(query, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(query, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_revision_detail_source(uuid,uuid,text,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_revision_detail_source(uuid,uuid,text,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
