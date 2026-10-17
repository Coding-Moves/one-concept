"""SQL review decisions preserve the original approval and receipt contracts."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.schemas.editorial_content import RevisionAction
from app.services import editorial_generation, editorial_revisions, editorial_workflow
from tests import test_editorial_content_api as content
from tests.test_content_quality import review


api = content.api
draft = content.draft
editorial = content.editorial

QUERY = text("""select public.edge_api_editorial_revision_action(
  :uid,:sid,:aal,:rid,:req,:note,:token,:action,cast(:quality as jsonb),
  :assignee,:due,:has_due,:valid,:auto,:enabled,:limit,:fp)""")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


async def action(api, session, rid, name, *, quality=None, token=None,
                 auto=False, enabled=False, assignee=None, due=None):
    token = token or (await content.detail(api, rid))["token"]
    fields = {
        "request_id": str(uuid.uuid4()), "note": content.NOTE,
        "expected_token": token, "action": name,
        "quality": quality, "assignee_id": str(assignee) if assignee else None,
    }
    if due is not None:
        fields["review_due_at"] = due
    command = RevisionAction.model_validate(fields)
    dump = command.model_dump(mode="json")
    wire = dump if name == "assign" else {k: v for k, v in dump.items()
                                          if k != "review_due_at"}
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "rid": rid, "req": command.request_id, "note": command.note,
            "token": token, "action": name,
            "quality": json.dumps(dump["quality"]) if quality is not None else None,
            "assignee": assignee, "due": command.review_due_at,
            "has_due": due is not None,
            "valid": True, "auto": auto, "enabled": enabled, "limit": 25,
            "fp": editorial_workflow.digest({
                "resource": f"revision:{rid}", "command": dump})}
    result = _json(await session.scalar(QUERY, args))
    assert "error" not in result, result
    await session.commit()
    replay = await api.client.post(
        f"{content.ROOT}/revisions/{rid}/actions",
        headers=api.headers(), json=wire)
    assert replay.status_code == 200, replay.text
    assert replay.json() == result
    assert _json(await session.scalar(QUERY, args)) == result
    assert _json(await session.scalar(QUERY, {**args, "fp": "f" * 64}))[
        "error"] == "receipt_conflict"
    return result


@pytest.mark.asyncio
async def test_comment_assignment_approval_and_publication_match_fastapi(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    source = await content.detail(api, rid)
    assert _json(await session.scalar(QUERY, {
        "uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal1",
        "rid": rid, "req": uuid.uuid4(), "note": content.NOTE,
        "token": source["token"], "action": "comment",
        "quality": None, "assignee": None, "due": None,
        "has_due": False, "valid": True, "auto": False,
        "enabled": False, "limit": 25, "fp": "f" * 64,
    }))["error"] == "mfa_required"
    commented = await action(api, session, rid, "comment")
    assert commented["token"] == source["token"]
    assigned = await action(api, session, rid, "assign", assignee=api.owner.id,
                            due="2026-10-18T12:34:56.123456Z")
    assert assigned["token"] != commented["token"]
    assert (await content.detail(api, rid))["token"] == assigned["token"]
    submitted = await action(api, session, rid, "submit")
    assert submitted["status"] == "pending_review"
    approved = await action(api, session, rid, "approved", quality=review())
    assert approved["status"] == "approved"
    published = await action(api, session, rid, "publish")
    assert published["status"] == "published" and published["published_version"] == 1
    assert await session.scalar(text("""select count(*) from editorial_publications
      where concept_id=:cid"""), {"cid": draft[1]}) == 1
    assert (await content.detail(api, rid))["token"] == published["token"]


@pytest.mark.asyncio
async def test_changes_requested_auto_queue_and_exact_approval(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    await action(api, session, rid, "submit")
    changed = await action(api, session, rid, "changes_requested",
                           auto=True, enabled=True)
    assert changed["status"] == "changes_requested"
    assert changed["generation_status"] == "queued"
    job_id = await session.scalar(text("""select id from editorial_generation_jobs
      where source_revision_id=:rid"""), {"rid": rid})
    assert job_id is not None
    job = await editorial_generation.get_job(session, job_id)
    current = await editorial_revisions.revision(session, rid, lock=False)
    assert job["source_token"] == await editorial_generation.source_token(session, current)
    await session.execute(text("""update editorial_generation_jobs
      set status='cancelled' where id=:id and status='pending'"""), {"id": job_id})
    await session.commit()


@pytest.mark.asyncio
async def test_approve_and_publish_is_one_atomic_review(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    await action(api, session, rid, "submit")
    published = await action(api, session, rid, "approve_and_publish", quality=review())
    assert published["status"] == "published"
    assert published["published_version"] == 1
    assert await session.scalar(text("""select count(*) from editorial_revision_events
      where revision_id=:rid and action='approved'"""), {"rid": rid}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["rejected", "retired"])
async def test_nonapproval_decisions_preserve_history(api, session, draft, decision):
    rid = await content.rid_for(session, draft[1])
    if decision == "rejected":
        await action(api, session, rid, "submit")
    result = await action(api, session, rid, decision)
    assert result["status"] == decision
    assert await session.scalar(text("""select count(*) from editorial_revision_events
      where revision_id=:rid and action=:action"""),
      {"rid": rid, "action": decision}) == 1


@pytest.mark.asyncio
async def test_revision_action_functions_are_service_only(session):
    for signature in ["edge_api_editorial_revision_token(uuid)",
                      "edge_api_editorial_revision_action(uuid,uuid,text,uuid,uuid,text,text,text,jsonb,uuid,timestamptz,boolean,boolean,boolean,boolean,integer,text)"]:
        authenticated, service = (await session.execute(text("""select
          has_function_privilege('authenticated',:signature,'EXECUTE'),
          has_function_privilege('service_role',:signature,'EXECUTE')"""),
          {"signature": f"public.{signature}"})).one()
        assert (authenticated, service) == (False, True)
