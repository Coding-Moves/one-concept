"""The concept preview source stays private and matches the reviewed read model."""

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
async def test_concept_detail_source_authorization_and_token(api, session, draft):
    query = text("""select public.edge_api_editorial_concept_detail_source(
      :uid,:sid,:aal,:cid)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "cid": draft[1]}
    expected = await api.client.get(
        f"{content.ROOT}/concepts/{draft[1]}", headers=api.headers())
    assert expected.status_code == 200, expected.text
    source = _json(await session.scalar(query, args))
    assert source["id"] == str(draft[1])
    assert source["title"] == expected.json()["body"]["title"]
    assert source["legacy_snapshot"] is None
    assert source["provenance"] is None
    assert editorial_workflow.digest({
        key: source[key] for key in (
            "snapshot", "status", "topic_active", "subtopic_active", "subtopic_slug"
        )
    }) == expected.json()["token"]
    assert _json(await session.scalar(query, {**args, "cid": uuid.uuid4()})) == {
        "error": "concept_not_found"
    }
    assert _json(await session.scalar(query, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(query, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_concept_detail_source(uuid,uuid,text,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_concept_detail_source(uuid,uuid,text,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
