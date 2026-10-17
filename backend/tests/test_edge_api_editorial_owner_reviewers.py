"""Owner reviewer metrics retain historical identity and UUID paging parity."""

import json
from datetime import date, datetime

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content
from tests.test_editorial_api import enroll
from tests.test_owner_reporting import concept, evidence


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_owner_reviewers_matches_backend_page_and_role_gate(api, session):
    reviewer, _, _ = await enroll(api, session)
    command = text("""select public.edge_api_editorial_owner_reviewers(
      :uid,:sid,:aal,:start,:end,:cursor,:limit)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "start": None, "end": None, "cursor": None, "limit": 1}
    expected = await api.client.get(f"{content.ROOT}/owner/reviewers",
                                    params={"limit": 1}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(command, args))
    body = expected.json()
    at_sql = datetime.fromisoformat(result.pop("observed_at"))
    at_http = datetime.fromisoformat(body.pop("observed_at"))
    assert abs((at_sql-at_http).total_seconds()) < 3
    assert result == body
    assert result["next_cursor"] is not None
    args["cursor"] = result["next_cursor"]
    expected = await api.client.get(f"{content.ROOT}/owner/reviewers",
      params={"limit": 1, "cursor": args["cursor"]}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(command, args))
    result.pop("observed_at")
    body = expected.json()
    body.pop("observed_at")
    assert result == body
    all_items = _json(await session.scalar(command,
      {**args, "cursor": None, "limit": 50}))["items"]
    assert {str(api.owner.id), str(reviewer)} <= {
      str(item["id"]) for item in all_items}
    assert _json(await session.scalar(command, {**args, "limit": 51}))["error"] == "invalid_page"
    assert _json(await session.scalar(command, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_owner_reviewers(uuid,uuid,text,date,date,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_owner_reviewers(uuid,uuid,text,date,date,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
    await session.execute(text("delete from auth.users where id=:uid"), {"uid": reviewer})
    await session.commit()


@pytest.mark.asyncio
async def test_owner_reviewer_historical_evidence_stays_private(api, session):
    concept_id = await concept(session)
    first = await evidence(session, api.owner.id, concept_id, 1, "Historical Owner")
    second = await evidence(session, api.owner.id, concept_id, 2, "Historical Owner")
    await session.commit()
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "start": date(2002,1,1), "end": date(2002,1,2),
            "cursor": None, "limit": 25}
    expected = await api.client.get(f"{content.ROOT}/owner/reviewers",
      params={"start": args["start"], "end": args["end"]}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(text("""select
      public.edge_api_editorial_owner_reviewers(
        :uid,:sid,:aal,:start,:end,:cursor,:limit)"""), args))
    result.pop("observed_at")
    body = expected.json()
    body.pop("observed_at")
    assert result == body
    owner = next(item for item in result["items"] if item["id"] == str(api.owner.id))
    assert owner["name"] == "Historical Owner"
    assert owner["approval_events"] == 2
    assert owner["approved_concepts"] == 1
    assert owner["published_concepts"] == 1
    assert "secret note" not in json.dumps(result)
    # The session-scoped disposable DB is shared with the existing owner-report tests.
    # Remove only this fixture's immutable evidence before those tests run.
    await session.execute(text("set local session_replication_role = replica"))
    await session.execute(text("""delete from public.editorial_publications
      where approval_id in (:first,:second)"""), {"first": first, "second": second})
    await session.execute(text("""delete from public.editorial_revision_events
      where id in (:first,:second)"""), {"first": first, "second": second})
    await session.execute(text("set local session_replication_role = origin"))
    await session.commit()
