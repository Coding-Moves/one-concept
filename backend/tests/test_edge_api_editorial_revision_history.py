"""Private revision history preserves concept bounds and current authority."""

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
async def test_editorial_revision_history_matches_backend_and_paginates(api, session, draft):
    command = text("""select public.edge_api_editorial_revision_history(
      :uid,:sid,:aal,:concept,:cursor,:limit)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "concept": draft[1], "cursor": None, "limit": 25}
    existing = await api.client.get(
        f"{content.ROOT}/concepts/{draft[1]}/revisions", headers=api.headers())
    assert existing.status_code == 200, existing.text
    assert _json(await session.scalar(command, args)) == existing.json()
    first_id = uuid.UUID(existing.json()["items"][0]["id"])
    second_id = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff0")
    await session.execute(text("""insert into public.concept_revisions
      (id,concept_id,base_version,body,status)
      select :new_id,concept_id,base_version,body,'draft'
      from public.concept_revisions where id=:old_id"""),
      {"new_id": second_id, "old_id": first_id})
    args["limit"] = 1
    first = _json(await session.scalar(command, args))
    assert first["items"][0]["id"] == str(first_id)
    assert first["next_cursor"] == str(first_id)
    args["cursor"] = first_id
    last = _json(await session.scalar(command, args))
    assert last["items"][0]["id"] == str(second_id)
    assert last["next_cursor"] is None
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("""grant select on public.concepts,
      public.concept_revisions to service_role"""))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(command, args))["items"][0]["id"] == str(second_id)
    await session.execute(text("reset role"))
    args["cursor"] = None
    args["concept"] = uuid.uuid4()
    assert _json(await session.scalar(command, args))["error"] == "concept_not_found"
    args["concept"] = draft[1]
    args["limit"] = 101
    assert _json(await session.scalar(command, args))["error"] == "invalid_page"
    args["limit"] = 25
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_revision_history(uuid,uuid,text,uuid,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_revision_history(uuid,uuid,text,uuid,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
