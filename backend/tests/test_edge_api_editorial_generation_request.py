"""Editorial demand recording keeps the bounded FastAPI target and receipt."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.services import editorial_workflow as workflow
from app.services.curriculum import PlannedLesson, import_lessons
from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_generation_request_records_one_bounded_target_and_replays(api, session, draft):
    topic = await session.scalar(text("select topic_id from public.concepts where id=:id"),
                                 {"id": draft[1]})
    await import_lessons(session, [PlannedLesson(
        slug="next-" + draft[0], topic_slug=draft[0],
        subtopic_slug="foundations", title="Next distinct lesson",
        curriculum={"objective": "Explain another independent fixture concept.",
                    "difficulty": 1,
                    "references": [{"title": "Python reference",
                                    "url": "https://docs.python.org/3/"}]})])
    await session.commit()
    command = {"request_id": str(uuid.uuid4()),
               "note": "Generate a lesson after review.",
               "topic_id": str(topic), "count": 10}
    fingerprint = workflow.digest({"resource": "generation", "command": command})
    sql = text("""select public.edge_api_editorial_request_generation(
      :uid,:sid,:aal,:topic,:request,:note,:count,:enabled,
      :review_limit,:batch_limit,:active_days,:fingerprint)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "topic": topic,
            "request": uuid.UUID(command["request_id"]), "note": command["note"],
            "count": command["count"], "enabled": True,
            "review_limit": 25, "batch_limit": 5, "active_days": 90,
            "fingerprint": fingerprint}
    assert _json(await session.scalar(sql, {**args, "aal": "aal1"}))[
        "error"] == "mfa_required"
    assert _json(await session.scalar(sql, {**args, "enabled": False}))[
        "error"] == "generation_disabled"
    result = _json(await session.scalar(sql, args))
    assert result["status"] == "demand_recorded"
    assert result["target"] == 2
    await session.commit()
    replay = await api.client.post(f"{content.ROOT}/generation-requests",
                                   headers=api.headers(), json=command)
    assert replay.status_code == 202, replay.text
    assert replay.json() == result
    assert await session.scalar(text("""select target_count
      from public.content_supply_targets where topic_id=:id"""), {"id": topic}) == 2
    assert _json(await session.scalar(sql, args)) == result
    assert _json(await session.scalar(sql, {**args, "fingerprint": "f" * 64}))[
        "error"] == "receipt_conflict"
    await session.commit()
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_request_generation(uuid,uuid,text,uuid,uuid,text,integer,boolean,integer,integer,integer,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_request_generation(uuid,uuid,text,uuid,uuid,text,integer,boolean,integer,integer,integer,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
