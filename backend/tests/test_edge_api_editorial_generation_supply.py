"""Private generation supply status keeps the FastAPI counts and config flags."""

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
async def test_editorial_generation_supply_matches_backend_and_role_gate(api, session, draft):
    topic = await session.scalar(text("select topic_id from public.concepts where id=:id"),
                                 {"id": draft[1]})
    command = text("""select public.edge_api_editorial_generation_supply(
      :uid,:sid,:aal,:topic,:floor,:capacity,:generation,:provider)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "topic": topic, "floor": api.settings.min_pool_per_topic,
            "capacity": api.settings.content_review_backlog_limit,
            "generation": api.settings.generation_enabled and api.settings.future_refill_enabled,
            "provider": bool(api.settings.gemini_api_key)}
    expected = await api.client.get(
        f"{content.ROOT}/generation-supply/{topic}", headers=api.headers())
    assert expected.status_code == 200, expected.text
    assert _json(await session.scalar(command, args)) == expected.json()
    args["topic"] = uuid.uuid4()
    assert _json(await session.scalar(command, args))["error"] == "topic_not_found"
    args["topic"] = topic
    args["capacity"] = 0
    assert _json(await session.scalar(command, args))["error"] == "invalid_config"
    args["capacity"] = api.settings.content_review_backlog_limit
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("grant select on all tables in schema public to service_role"))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(command, args))["topic_id"] == str(topic)
    await session.execute(text("reset role"))
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_generation_supply(uuid,uuid,text,uuid,integer,integer,boolean,boolean)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_generation_supply(uuid,uuid,text,uuid,integer,integer,boolean,boolean)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
