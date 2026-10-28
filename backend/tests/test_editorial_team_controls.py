"""Reviewer capacity and removal use real PostgreSQL authority and FK rules."""

import json
from uuid import uuid4

from sqlalchemy import text

from tests import test_editorial_content_api as content
from tests.test_editorial_api import auth_account, enroll, profile_and_approve


api = content.api
editorial = content.editorial
draft = content.draft


async def test_ten_active_reviewers_including_owner_and_reactivation(api, session):
    reviewers = [await enroll(api, session) for _ in range(9)]
    assert all(member["require_mfa"] is False for _, _, member in reviewers)
    candidate, _, email = await auth_account(session)
    response = await api.client.post(
        "/v1/editorial/reviewers", headers=api.headers(),
        json={"email": email, "capabilities": ["review"]},
    )
    assert response.status_code == 409
    assert "10 active" in response.json()["detail"]
    assert await session.scalar(text("""select count(*) from public.editorial_memberships
      where status='active'""")) == 10
    assert not await session.scalar(text("""select exists(select 1 from public.editorial_memberships
      where user_id=:id)"""), {"id": candidate})
    prepared = await session.scalar(text("""select public.edge_api_editorial_invite_prepare(
      :owner,:session,'aal2',:email)"""),
      {"owner": api.owner.id, "session": api.owner.session_id, "email": email})
    if isinstance(prepared, str):
        prepared = json.loads(prepared)
    assert prepared == {"error": "team_full"}

    removed, _, member = reviewers[0]
    revoked = await api.client.patch(
        f"/v1/editorial/reviewers/{removed}/access", headers=api.headers(),
        json={"expected_version": member["version"], "status": "revoked",
              "capabilities": ["review"]},
    )
    assert revoked.status_code == 200, revoked.text
    added = await api.client.post(
        "/v1/editorial/reviewers", headers=api.headers(),
        json={"email": email, "capabilities": ["review"]},
    )
    assert added.status_code == 201, added.text
    assert added.json()["require_mfa"] is False
    reactivated = await api.client.patch(
        f"/v1/editorial/reviewers/{removed}/access", headers=api.headers(),
        json={"expected_version": revoked.json()["version"], "status": "active",
              "capabilities": ["review"]},
    )
    assert reactivated.status_code == 409
    assert await session.scalar(text("""select status from public.editorial_memberships
      where user_id=:id"""), {"id": removed}) == "revoked"
    edge_reactivation = await session.scalar(text("""select public.edge_api_editorial_reviewer_access(
      :owner,:session,'aal2',:subject,:version,'active',array['review']::text[])"""),
      {"owner": api.owner.id, "session": api.owner.session_id,
       "subject": removed, "version": revoked.json()["version"]})
    if isinstance(edge_reactivation, str):
        edge_reactivation = json.loads(edge_reactivation)
    assert edge_reactivation == {"error": "team_full"}


async def test_removal_keeps_learning_account_and_review_evidence(api, session, draft):
    reviewer, sid, member = await enroll(api, session)
    member = await profile_and_approve(api, reviewer, sid)
    rid = await content.rid_for(session, draft[1])
    assigned, _ = await content.act(api, rid, "assign", assignee_id=str(reviewer))
    assert assigned.status_code == 200, assigned.text
    topic = await session.scalar(text("select id from public.topics order by id limit 1"))
    batch_id = uuid4()
    await session.execute(text("""insert into public.editorial_legacy_batches
      (id,topic_id,name,requested_by,model,prompt_version,quota_limit)
      values(:id,:topic,:name,:reviewer,'test','v1',1)"""),
      {"id": batch_id, "topic": topic, "name": f"batch-{batch_id.hex[:12]}",
       "reviewer": reviewer})
    await session.commit()

    stale = await api.client.delete(
        f"/v1/editorial/reviewers/{reviewer}?expected_version={member['version']-1}",
        headers=api.headers(),
    )
    assert stale.status_code == 409
    removed = await api.client.delete(
        f"/v1/editorial/reviewers/{reviewer}?expected_version={member['version']}",
        headers=api.headers(),
    )
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"removed_user_id": str(reviewer), "unassigned_count": 1}
    assert (await api.client.get("/v1/editorial/me", headers=api.headers(reviewer, sid))).status_code == 403
    assert await session.scalar(text("select exists(select 1 from auth.users where id=:id)"),
      {"id": reviewer})
    assert await session.scalar(text("select exists(select 1 from public.profiles where id=:id)"),
      {"id": reviewer})
    assert await session.scalar(text("""select exists(select 1 from public.editorial_legacy_batches
      where id=:id and requested_by=:reviewer)"""),
      {"id": batch_id, "reviewer": reviewer})
    assignment = (await session.execute(text("""select assigned_to,review_due_at
      from public.concept_revisions where id=:id"""), {"id": rid})).one()
    assert assignment == (None, None)
    assert await session.scalar(text("""select count(*) from public.editorial_account_events
      where subject_id=:id and action='reviewer_removed'"""), {"id": reviewer}) == 1
    assert (await api.client.get("/v1/editorial/reviewers", headers=api.headers())).json()["items"] == [
        (await api.client.get("/v1/editorial/me", headers=api.headers())).json()["member"]
    ]
    assert (await api.client.delete(
        f"/v1/editorial/reviewers/{reviewer}?expected_version={member['version']}",
        headers=api.headers(),
    )).status_code == 404
    assert (await api.client.delete(
        f"/v1/editorial/reviewers/{api.owner.id}?expected_version=1",
        headers=api.headers(),
    )).status_code == 403


async def test_edge_removal_runs_as_service_role(api, session):
    reviewer, _, member = await enroll(api, session)
    args = {"owner": api.owner.id, "session": api.owner.session_id,
            "reviewer": reviewer, "version": member["version"]}
    await session.execute(text("set local role service_role"))
    removed = await session.scalar(text("""select public.edge_api_editorial_reviewer_remove(
      :owner,:session,'aal2',:reviewer,:version)"""), args)
    await session.execute(text("reset role"))
    if isinstance(removed, str):
        removed = json.loads(removed)
    assert removed == {"removed_user_id": str(reviewer), "unassigned_count": 0}
    assert await session.scalar(text("select exists(select 1 from auth.users where id=:reviewer)"), args)
    assert await session.scalar(text("""select prosecdef from pg_proc
      where oid=to_regprocedure('public.edge_api_editorial_reviewer_remove(uuid,uuid,text,uuid,integer)')"""))
    assert await session.scalar(text("""select has_function_privilege('service_role',
      'public.edge_api_editorial_reviewer_remove(uuid,uuid,text,uuid,integer)', 'EXECUTE')"""))
    assert not await session.scalar(text("""select has_function_privilege('authenticated',
      'public.edge_api_editorial_reviewer_remove(uuid,uuid,text,uuid,integer)', 'EXECUTE')"""))
