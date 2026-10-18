"""Owner learner metrics preserve UTC windows and exclude editorial-only accounts."""

import json
import uuid
from datetime import date, datetime

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content
from tests.test_editorial_api import auth_account


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_owner_overview_matches_backend_window_and_role_gate(api, session):
    learner, _, _ = await auth_account(session)
    topic, concept = uuid.uuid4(), uuid.uuid4()
    await session.execute(text("""insert into public.topics(id,slug,name,is_active)
      values(:id,:slug,'Historical metrics',false)"""),
      {"id": topic, "slug": str(topic)})
    await session.execute(text("""insert into public.concepts(id,topic_id,slug,title,summary)
      values(:id,:topic,:slug,'Historical lesson','Summary')"""),
      {"id": concept, "topic": topic, "slug": str(concept)})
    await session.execute(text("""update public.profiles set
      created_at='2001-01-01T00:00:00Z' where id=:uid"""), {"uid": learner})
    await session.execute(text("""insert into public.user_concept_completions
      (user_id,concept_id,completed_at)
      values(:uid,:cid,'2001-01-02T23:59:00Z')"""),
      {"uid": learner, "cid": concept})
    await session.commit()
    read = text("""select public.edge_api_editorial_owner_overview(
      :uid,:sid,:aal,:start,:end)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "start": date(2001,1,2), "end": date(2001,1,2)}
    expected = await api.client.get(f"{content.ROOT}/owner/overview",
      params={"start": "2001-01-02", "end": "2001-01-02"}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(read, args))
    body = expected.json()
    observed_sql = datetime.fromisoformat(result.pop("observed_at"))
    observed_http = datetime.fromisoformat(body.pop("observed_at"))
    assert abs((observed_sql-observed_http).total_seconds()) < 3
    assert result == body
    assert result["metrics"]["registered"] == 1
    assert result["metrics"]["lessons"] == 1
    assert result["trend"] == [{"day": "2001-01-02", "lessons": 1,
                                "reviews": 0, "active": 1}]
    args["end"] = date(1,1,29)
    assert _json(await session.scalar(read, args))["error"] == "invalid_end"
    args["end"] = date(2001,1,2)
    args["start"] = date(2001,1,3)
    assert _json(await session.scalar(read, args))["error"] == "invalid_range"
    args["start"] = date(2001,1,2)
    args["aal"] = "aal1"
    assert _json(await session.scalar(read, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(read, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_owner_overview(uuid,uuid,text,date,date)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_owner_overview(uuid,uuid,text,date,date)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
    await session.execute(text("delete from auth.users where id=:uid"), {"uid": learner})
    await session.commit()
