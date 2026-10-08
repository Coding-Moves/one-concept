"""Real HTTP/JWT and PostgreSQL editorial workflows; all provider I/O blocked."""

import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services import editorial_queries
from app.services.selection import get_or_create_daily
from tests import test_editorial_api, test_editorial_authority, test_publication
from tests.test_content_quality import review

editorial = test_editorial_authority.editorial
api = test_editorial_api.api
draft = test_publication.draft
NOTE = "Checked the complete lesson package against the listed references."
ROOT = "/v1/editorial"


async def rid_for(session, cid):
    return await session.scalar(
        text("select id from concept_revisions where concept_id=:id"), {"id": cid}
    )


async def detail(api, rid):
    response = await api.client.get(f"{ROOT}/revisions/{rid}", headers=api.headers())
    assert response.status_code == 200, response.text
    return response.json()


async def act(api, rid, action, token=None, **fields):
    token = token or (await detail(api, rid))["token"]
    payload = dict(
        request_id=str(uuid4()), expected_token=token, action=action, note=NOTE
    )
    if action in ("approved", "approve_and_publish"):
        payload["quality"] = review()
    payload.update(fields)
    response = await api.client.post(
        f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=payload
    )
    return response, payload


async def test_queue_detail_comments_assignment_and_atomic_publication(
    api, session, draft
):
    rid = await rid_for(session, draft[1])
    response = await api.client.get(
        f"{ROOT}/queue", headers=api.headers(), params={"search": draft[0], "limit": 1}
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["id"] == str(rid)
    body = await detail(api, rid)
    assert (
        body["validation"]["valid"]
        and len(body["body"]["learning_package"]["mcqs"]) == 3
    )
    assert body["text_format"] == "markdown" and body["source_links"]
    assert (await act(api, rid, "comment"))[0].status_code == 200
    assert (await act(api, rid, "assign", assignee_id=str(api.owner.id)))[
        0
    ].status_code == 200
    assert (await act(api, rid, "submit"))[0].json()["status"] == "pending_review"
    pending = await detail(api, rid)
    result, payload = await act(api, rid, "approve_and_publish", pending["token"])
    assert result.status_code == 200, result.text
    assert (
        result.json()["status"] == "published"
        and result.json()["published_version"] == 1
    )
    published = await detail(api, rid)
    assert published["status"] == "published"
    assert published["base_version"] == 0
    assert published["validation"]["valid"]
    assert published["body"]["title"] == body["body"]["title"]
    assert published["source_body"] == body["source_body"]
    assert published["diff"] == body["diff"]
    assert published["source_links"]
    replay = await api.client.post(
        f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=payload
    )
    assert replay.json() == result.json()
    assert (
        await session.scalar(
            text("select count(*) from editorial_publications where concept_id=:id"),
            {"id": draft[1]},
        )
        == 1
    )
    page = await api.client.get(
        f"{ROOT}/concepts/{draft[1]}/timeline?limit=2", headers=api.headers()
    )
    events = page.json()["items"]
    while page.json()["next_cursor"]:
        page = await api.client.get(
            f"{ROOT}/concepts/{draft[1]}/timeline",
            headers=api.headers(),
            params={"cursor": page.json()["next_cursor"], "limit": 2},
        )
        assert page.status_code == 200, page.text
        events.extend(page.json()["items"])
    assert len({e["id"] for e in events}) == len(events) == 5
    assert {e["action"] for e in events} == {
        "comment",
        "assigned",
        "pending_review",
        "approved",
        "published",
    }
    assert {e["registered_name"] for e in events} == {"Initial Owner"}
    assert next(e for e in events if e["action"] == "published")["note"] == NOTE
    forged = payload | {"note": "This is a different operation with a reused key."}
    assert (
        await api.client.post(
            f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=forged
        )
    ).status_code == 409


@pytest.mark.parametrize("decision", ["changes_requested", "rejected", "retired"])
async def test_nonapproval_paths_and_new_revision_preserve_content(
    api, session, draft, decision
):
    rid = await rid_for(session, draft[1])
    assert (await act(api, rid, "submit"))[0].status_code == 200
    response, _ = await act(api, rid, decision)
    assert response.status_code == 200 and response.json()["status"] == decision
    assert (await act(api, rid, "publish"))[0].status_code == 409
    assert (
        await session.scalar(
            text("select status from concepts where id=:id"), {"id": draft[1]}
        )
        == "draft"
    )
    source = (
        await api.client.get(f"{ROOT}/concepts/{draft[1]}", headers=api.headers())
    ).json()
    body = (await detail(api, rid))["body"]
    stage = await api.client.post(
        f"{ROOT}/concepts/{draft[1]}/revisions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": source["token"],
            "note": NOTE,
            "body": body,
        },
    )
    assert stage.status_code == 201, stage.text
    assert stage.json()["revision_id"] != str(rid)
    history = await api.client.get(
        f"{ROOT}/concepts/{draft[1]}/revisions?limit=1", headers=api.headers()
    )
    assert history.json()["next_cursor"] and len(history.json()["items"]) == 1


async def test_role_checks_forged_identity_and_separate_publication(
    api, session, draft
):
    rid = await rid_for(session, draft[1])
    assert (await api.client.get(f"{ROOT}/queue")).status_code == 401
    assert (
        await api.client.get(f"{ROOT}/queue", headers=api.headers(aal="aal1"))
    ).status_code == 403
    response, _ = await act(api, rid, "submit", reviewer_name="Forged Person")
    assert response.status_code == 422
    await act(api, rid, "submit")
    pending = await detail(api, rid)
    for caps in (["review"], ["approve"]):
        await session.execute(
            text(
                "update editorial_memberships set capabilities=:caps where user_id=:id"
            ),
            {"caps": caps, "id": api.owner.id},
        )
        await session.commit()
        assert (await act(api, rid, "approve_and_publish", pending["token"]))[
            0
        ].status_code == 403
    approval, _ = await act(api, rid, "approved", pending["token"])
    assert approval.status_code == 200
    assert (await act(api, rid, "publish", approval.json()["token"]))[
        0
    ].status_code == 403
    await session.execute(
        text(
            "update editorial_memberships set capabilities=array['publish'] where user_id=:id"
        ),
        {"id": api.owner.id},
    )
    await session.commit()
    published, payload = await act(api, rid, "publish", approval.json()["token"])
    assert published.status_code == 200, published.text
    await session.execute(
        text("delete from auth.sessions where id=:id"), {"id": api.owner.session_id}
    )
    await session.commit()
    assert (
        await api.client.post(
            f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=payload
        )
    ).status_code == 401


@pytest.mark.parametrize("capability", ["approve", "publish"])
async def test_decision_roles_can_read_private_work_with_mfa(
    api, session, draft, capability
):
    rid = await rid_for(session, draft[1])
    await session.execute(
        text("update editorial_memberships set capabilities=:caps where user_id=:id"),
        {"caps": [capability], "id": api.owner.id},
    )
    await session.commit()
    for path in (f"{ROOT}/queue", f"{ROOT}/revisions/{rid}"):
        allowed = await api.client.get(path, headers=api.headers())
        assert allowed.status_code == 200, allowed.text
        denied = await api.client.get(path, headers=api.headers(aal="aal1"))
        assert denied.status_code == 403
    denied = await api.client.get(f"{ROOT}/activity", headers=api.headers())
    assert denied.status_code == 403


async def test_assignment_requires_readable_reviewer_and_publication_reaches_learner(
    api, session, draft
):
    rid = await rid_for(session, draft[1])
    approver_id, approver_session, _ = await test_editorial_api.enroll(
        api, session, ["approve"]
    )
    await test_editorial_api.profile_and_approve(api, approver_id, approver_session)
    rejected, _ = await act(api, rid, "assign", assignee_id=str(approver_id))
    assert rejected.status_code == 409
    assert (
        await session.scalar(
            text("select assigned_to from concept_revisions where id=:id"), {"id": rid}
        )
        is None
    )

    reviewer_id, reviewer_session, _ = await test_editorial_api.enroll(
        api, session, ["review", "approve"]
    )
    await test_editorial_api.profile_and_approve(
        api, reviewer_id, reviewer_session, name="Second Reviewer"
    )
    assigned, _ = await act(api, rid, "assign", assignee_id=str(reviewer_id))
    assert assigned.status_code == 200, assigned.text
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_notification_outbox where revision_id=:id"
            ),
            {"id": rid},
        )
        == 1
    )
    reviewer_headers = api.headers(reviewer_id, reviewer_session)
    reviewer_detail = await api.client.get(
        f"{ROOT}/revisions/{rid}", headers=reviewer_headers
    )
    assert reviewer_detail.status_code == 200, reviewer_detail.text
    pending = await api.client.post(
        f"{ROOT}/revisions/{rid}/actions",
        headers=reviewer_headers,
        json={
            "request_id": str(uuid4()),
            "expected_token": reviewer_detail.json()["token"],
            "action": "submit",
            "note": NOTE,
        },
    )
    assert pending.status_code == 200, pending.text
    learner_id, learner_session, _ = await test_editorial_api.auth_account(session)
    before = await api.client.get(
        f"/v1/concepts/{draft[0]}", headers=api.headers(learner_id, learner_session)
    )
    assert before.status_code == 404
    changes = await api.client.post(
        f"{ROOT}/revisions/{rid}/actions",
        headers=reviewer_headers,
        json={
            "request_id": str(uuid4()),
            "expected_token": pending.json()["token"],
            "action": "changes_requested",
            "note": "Clarify the worked example before publication.",
        },
    )
    assert changes.status_code == 200, changes.text
    concept = (
        await api.client.get(f"{ROOT}/concepts/{draft[1]}", headers=api.headers())
    ).json()
    corrected_body = (await detail(api, rid))["body"] | {
        "example": "A worked example with the requested clarification. " * 4,
    }
    staged = await api.client.post(
        f"{ROOT}/concepts/{draft[1]}/revisions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": concept["token"],
            "note": "Applied the reviewer's requested clarification.",
            "body": corrected_body,
        },
    )
    assert staged.status_code == 201, staged.text
    corrected_id = staged.json()["revision_id"]
    assert corrected_id != str(rid)
    assert (await act(api, corrected_id, "assign", assignee_id=str(reviewer_id)))[
        0
    ].status_code == 200
    corrected_detail = await api.client.get(
        f"{ROOT}/revisions/{corrected_id}", headers=reviewer_headers
    )
    assert corrected_detail.status_code == 200, corrected_detail.text
    corrected_pending = await api.client.post(
        f"{ROOT}/revisions/{corrected_id}/actions",
        headers=reviewer_headers,
        json={
            "request_id": str(uuid4()),
            "expected_token": corrected_detail.json()["token"],
            "action": "submit",
            "note": NOTE,
        },
    )
    assert corrected_pending.status_code == 200, corrected_pending.text
    approved = await api.client.post(
        f"{ROOT}/revisions/{corrected_id}/actions",
        headers=reviewer_headers,
        json={
            "request_id": str(uuid4()),
            "expected_token": corrected_pending.json()["token"],
            "action": "approved",
            "note": NOTE,
            "quality": review(),
        },
    )
    assert approved.status_code == 200, approved.text
    unpublished = await api.client.get(
        f"/v1/concepts/{draft[0]}", headers=api.headers(learner_id, learner_session)
    )
    assert unpublished.status_code == 404
    published, _ = await act(api, corrected_id, "publish", approved.json()["token"])
    assert published.status_code == 200, published.text
    learner = await api.client.get(
        f"/v1/concepts/{draft[0]}", headers=api.headers(learner_id, learner_session)
    )
    assert learner.status_code == 200, learner.text
    assert learner.json()["content_version"] == 1
    assert learner.json()["example"] == corrected_body["example"].strip()
    assert learner.json()["review"]["name"] == "Second Reviewer"


@pytest.mark.parametrize("damage", ["duplicate", "prerequisite", "taxonomy"])
async def test_atomic_failure_rolls_back_approval_and_receipt(
    api, session, draft, damage
):
    rid = await rid_for(session, draft[1])
    seed = (
        await session.execute(
            text("select id,slug,title from concepts where status='published' limit 1")
        )
    ).one()
    if damage == "duplicate":
        await session.execute(
            text(
                "update concept_revisions set body=jsonb_set(body,'{title}',cast(:title as jsonb)) where id=:id"
            ),
            {"id": rid, "title": json.dumps(seed.title)},
        )
    if damage == "prerequisite":
        await session.execute(
            text(
                "update concept_revisions set body=jsonb_set(body,'{curriculum,prerequisites}',cast(:p as jsonb)) where id=:id"
            ),
            {"id": rid, "p": json.dumps([seed.slug])},
        )
        await session.execute(
            text("update concepts set status='draft' where id=:id"), {"id": seed.id}
        )
    await session.commit()
    try:
        assert (await act(api, rid, "submit"))[0].status_code == 200
        if damage == "taxonomy":
            await session.execute(
                text(
                    "update subtopics set is_active=false where id=(select subtopic_id from concepts where id=:id)"
                ),
                {"id": draft[1]},
            )
            await session.commit()
        state = await detail(api, rid)
        assert not state["validation"]["valid"]
        response, payload = await act(api, rid, "approve_and_publish", state["token"])
        assert response.status_code == 409, response.text
        assert (
            await session.scalar(
                text("select status from concept_revisions where id=:id"), {"id": rid}
            )
            == "pending_review"
        )
        assert (
            await session.scalar(
                text(
                    "select count(*) from editorial_revision_events where revision_id=:id and action='approved'"
                ),
                {"id": rid},
            )
            == 0
        )
        assert (
            await session.scalar(
                text(
                    "select count(*) from editorial_request_receipts where request_id=:id"
                ),
                {"id": payload["request_id"]},
            )
            == 0
        )
    finally:
        if damage == "prerequisite":
            await session.execute(
                text("update concepts set status='published' where id=:id"),
                {"id": seed.id},
            )
            await session.commit()


@pytest.mark.parametrize("same_request", [False, True])
async def test_concurrent_publication_and_duplicate_requests(
    api, session, draft, same_request
):
    rid = await rid_for(session, draft[1])
    await act(api, rid, "submit")
    state = await detail(api, rid)
    one = dict(
        action="approve_and_publish",
        expected_token=state["token"],
        note=NOTE,
        quality=review(),
        request_id=str(uuid4()),
    )
    two = one if same_request else one | {"request_id": str(uuid4())}
    responses = await asyncio.gather(
        *[
            api.client.post(
                f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=p
            )
            for p in (one, two)
        ]
    )
    assert sorted(r.status_code for r in responses) == (
        [200, 200] if same_request else [200, 409]
    )
    assert (
        await session.scalar(
            text("select content_version from concepts where id=:id"), {"id": draft[1]}
        )
        == 1
    )


async def test_validation_failure_payload_bounds_and_untrusted_text(
    api, session, draft
):
    rid = await rid_for(session, draft[1])
    await session.execute(
        text(
            "update concept_revisions set body=jsonb_set(body-'learning_package','{title}',cast(:title as jsonb)) where id=:id"
        ),
        {"id": rid, "title": json.dumps("<script>alert(1)</script>")},
    )
    await session.commit()
    state = await detail(api, rid)
    assert not state["validation"]["valid"] and state["body"]["title"].startswith(
        "<script>"
    )
    response, _ = await act(api, rid, "submit")
    assert (
        response.status_code == 200 and response.json()["status"] == "validation_failed"
    )
    assert (await act(api, rid, "approve_and_publish"))[0].status_code == 409
    assert (
        await api.client.get(f"{ROOT}/queue?limit=101", headers=api.headers())
    ).status_code == 422
    assert (
        await api.client.get(
            f"{ROOT}/concepts/{draft[1]}/timeline?cursor=bad", headers=api.headers()
        )
    ).status_code == 422
    oversized = await api.client.post(
        f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), content=b"x" * 65537
    )
    assert oversized.status_code == 413
    assert oversized.headers["cache-control"] == "no-store"
    assert oversized.headers["x-content-type-options"] == "nosniff"
    assert editorial_queries.source_links(
        {
            "curriculum": {
                "references": [
                    {"url": "javascript:alert(1)"},
                    {"url": "https://user:pass@example.com"},
                    {"url": "https://docs.python.org/3/", "title": "Python"},
                ]
            }
        }
    ) == [{"url": "https://docs.python.org/3/", "title": "Python"}]


async def test_workflow_tables_are_private_and_append_only(api, session, draft):
    rid = await rid_for(session, draft[1])
    await act(api, rid, "comment")
    for table in ("editorial_workflow_events", "editorial_request_receipts"):
        with pytest.raises(DBAPIError):
            async with session.begin_nested():
                await session.execute(text(f"delete from {table}"))
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert not await session.scalar(
                text("select has_table_privilege('authenticated',:t,:p)"),
                {"t": table, "p": privilege},
            )


async def test_published_correction_is_invisible_until_approval(api, session, draft):
    rid = await rid_for(session, draft[1])
    await act(api, rid, "submit")
    assert (await act(api, rid, "approve_and_publish"))[0].status_code == 200
    source = (
        await api.client.get(f"{ROOT}/concepts/{draft[1]}", headers=api.headers())
    ).json()
    body = (await detail(api, rid))["body"]
    old = source["body"]["summary"]
    body["summary"] = (
        "An improved explanation preserving the stable lesson and learner history. " * 3
    )
    stage = await api.client.post(
        f"{ROOT}/concepts/{draft[1]}/revisions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": source["token"],
            "note": NOTE,
            "body": body,
        },
    )
    assert stage.status_code == 201, stage.text
    new = stage.json()["revision_id"]
    await act(api, new, "submit")
    assert (
        await session.scalar(
            text("select summary from concepts where id=:id"), {"id": draft[1]}
        )
        == old
    )
    assert (await act(api, new, "approve_and_publish"))[0].json()[
        "published_version"
    ] == 2
    historical = await detail(api, rid)
    assert historical["source_body"]["summary"].strip() == old
    assert historical["body"]["summary"].strip() == old
    assert historical["validation"]["valid"]
    corrected = await detail(api, new)
    assert corrected["source_body"]["summary"] == old
    assert any(item["field"] == "summary" for item in corrected["diff"])
    assert (
        await session.scalar(
            text("select summary from concepts where id=:id"), {"id": draft[1]}
        )
        == body["summary"].strip()
    )
    # A compatible learner gets the publication through ordinary reads; no build.
    await session.execute(
        text("delete from user_topics where user_id=:id"), {"id": api.owner.id}
    )
    await session.execute(
        text(
            "insert into user_topics(user_id,topic_id) select :uid,topic_id from concepts where id=:cid"
        ),
        {"uid": api.owner.id, "cid": draft[1]},
    )
    await session.commit()
    daily = await get_or_create_daily(session, api.owner.id)
    assert daily.concept.id == draft[1] and daily.concept.content_version == 2
    assert (
        await get_or_create_daily(session, api.owner.id)
    ).concept.id == daily.concept.id


async def test_published_detail_survives_content_retirement(api, session, draft):
    rid = await rid_for(session, draft[1])
    before = await detail(api, rid)
    await act(api, rid, "submit")
    assert (await act(api, rid, "approve_and_publish"))[0].status_code == 200
    published = await detail(api, rid)
    concept = (
        await api.client.get(f"{ROOT}/concepts/{draft[1]}", headers=api.headers())
    ).json()
    retired = await api.client.post(
        f"{ROOT}/concepts/{draft[1]}/actions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": concept["token"],
            "action": "retire",
            "note": NOTE,
        },
    )
    assert retired.status_code == 200, retired.text
    historical = await detail(api, rid)
    assert (
        historical["source_body"] == before["source_body"] == published["source_body"]
    )
    assert historical["diff"] == published["diff"]
    assert historical["validation"]["valid"]
    assert all(
        error["field"] != "base_version" for error in historical["validation"]["errors"]
    )


async def test_captured_legacy_revision_has_structured_historical_detail(
    api, session, draft
):
    rid = await rid_for(session, draft[1])
    original = (await detail(api, rid))["body"]
    await session.execute(
        text("""update concepts set status='published',content_version=1,
          flashcard=cast(:flashcard as jsonb),mcqs=cast(:mcqs as jsonb)
          where id=:id"""),
        {
            "id": draft[1],
            "flashcard": json.dumps(original["learning_package"]["flashcard"]),
            "mcqs": json.dumps(original["learning_package"]["mcqs"]),
        },
    )
    await session.commit()
    concept = (
        await api.client.get(f"{ROOT}/concepts/{draft[1]}", headers=api.headers())
    ).json()
    correction = original | {"summary": "A revised and approved lesson summary. " * 5}
    staged = await api.client.post(
        f"{ROOT}/concepts/{draft[1]}/revisions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": concept["token"],
            "note": NOTE,
            "body": correction,
        },
    )
    assert staged.status_code == 201, staged.text
    replacement = staged.json()["revision_id"]
    await act(api, replacement, "submit")
    published, _ = await act(api, replacement, "approve_and_publish")
    assert published.status_code == 200, published.text
    captured_id = await session.scalar(
        text("""select id from concept_revisions where concept_id=:id
          and status='published' and id<>:replacement"""),
        {"id": draft[1], "replacement": replacement},
    )
    captured = await detail(api, captured_id)
    assert captured["validation"]["valid"]
    assert captured["body"]["learning_package"] == original["learning_package"]
    assert "flashcard" not in captured["body"]


@pytest.mark.parametrize("duplicate", [False, True])
async def test_legacy_attestation_and_retirement_preserve_learning_history(
    api, session, draft, duplicate
):
    cid = draft[1]
    rid = await rid_for(session, cid)
    body = (await detail(api, rid))["body"]
    if duplicate:
        await session.execute(
            text("""update concepts set title=(select title from concepts
            where status='published' and id<>:id limit 1) where id=:id"""),
            {"id": cid},
        )
    # Exact synthetic legacy record at cutover, without inventing approval.
    await session.execute(
        text("""update concepts set status='published',content_version=1,
        flashcard=cast(:f as jsonb),mcqs=cast(:m as jsonb) where id=:id"""),
        {
            "id": cid,
            "f": json.dumps(body["learning_package"]["flashcard"]),
            "m": json.dumps(body["learning_package"]["mcqs"]),
        },
    )
    await session.execute(
        text("""insert into editorial_legacy_versions(concept_id,content_version,snapshot)
        select c.id,c.content_version,to_jsonb(c)-array['created_at','published_at','status'] from concepts c where id=:id"""),
        {"id": cid},
    )
    await session.execute(
        text("""insert into daily_assignments(user_id,concept_id,assigned_for,completed_at)
        values (:uid,:cid,current_date,now())"""),
        {"uid": api.owner.id, "cid": cid},
    )
    await session.commit()
    queue = await api.client.get(
        f"{ROOT}/queue",
        headers=api.headers(),
        params={
            "kind": "legacy",
            "topic_id": str(await session.scalar(
                text("select topic_id from concepts where id=:id"), {"id": cid}
            )),
        },
    )
    assert len(queue.json()["items"]) == 1
    source = (
        await api.client.get(f"{ROOT}/concepts/{cid}", headers=api.headers())
    ).json()
    assert source["unchanged_legacy"] and source["provenance"] is None
    payload = dict(
        request_id=str(uuid4()),
        expected_token=source["token"],
        note=NOTE,
        action="attest",
        quality=review(),
    )
    response = await api.client.post(
        f"{ROOT}/concepts/{cid}/actions", headers=api.headers(), json=payload
    )
    if duplicate:
        assert response.status_code == 409, response.text
        assert not await session.scalar(
            text("select exists(select 1 from editorial_publications where concept_id=:id)"),
            {"id": cid},
        )
        return
    assert response.status_code == 200, response.text
    again = await api.client.post(
        f"{ROOT}/concepts/{cid}/actions", headers=api.headers(), json=payload
    )
    assert again.json() == response.json()
    source = (
        await api.client.get(f"{ROOT}/concepts/{cid}", headers=api.headers())
    ).json()
    assert (
        source["content_version"] == 1
        and source["provenance"]["registered_name"] == "Initial Owner"
    )
    retired = await api.client.post(
        f"{ROOT}/concepts/{cid}/actions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": source["token"],
            "action": "retire",
            "note": NOTE,
        },
    )
    assert retired.status_code == 200 and retired.json()["status"] == "archived"
    assert (
        await session.scalar(
            text(
                "select count(*) from daily_assignments where user_id=:id and completed_at is not null"
            ),
            {"id": api.owner.id},
        )
        == 1
    )
    assert (await get_or_create_daily(session, api.owner.id)).status == "exhausted"


async def test_generation_demand_is_bounded_coalesced_audited_and_kill_switched(
    api, session, draft
):
    from app.services.curriculum import PlannedLesson, import_lessons

    cid = draft[1]
    topic = await session.scalar(
        text("select topic_id from concepts where id=:id"), {"id": cid}
    )
    body = (await detail(api, await rid_for(session, cid)))["body"]
    await import_lessons(
        session,
        [
            PlannedLesson(
                slug="next-" + draft[0],
                topic_slug=draft[0],
                subtopic_slug="foundations",
                title="Next distinct lesson",
                curriculum=body["curriculum"]
                | {"objective": "Explain a new independent fixture concept in detail."},
            )
        ],
    )
    await session.commit()
    payload = dict(request_id=str(uuid4()), topic_id=str(topic), count=10, note=NOTE)
    response = await api.client.post(
        f"{ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert response.status_code == 409
    api.settings.generation_enabled = True
    response = await api.client.post(
        f"{ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert response.status_code == 409 and "Future lesson generation is paused" in response.text
    api.settings.future_refill_enabled = True
    response = await api.client.post(
        f"{ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert response.status_code == 202, response.text
    assert (
        response.json()["status"] == "demand_recorded"
        and response.json()["target"] == 2
    )
    duplicate = await api.client.post(
        f"{ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert duplicate.json() == response.json()
    await api.client.post(
        f"{ROOT}/generation-requests",
        headers=api.headers(),
        json=payload | {"request_id": str(uuid4())},
    )
    assert (
        await session.scalar(
            text("select target_count from content_supply_targets where topic_id=:id"),
            {"id": topic},
        )
        == 2
    )
    activity = await api.client.get(
        f"{ROOT}/activity", headers=api.headers(), params={"topic_id": str(topic)}
    )
    assert len(activity.json()["items"]) == 2
    assert all(e["details"]["bounded_count"] == 1 for e in activity.json()["items"])
    assert (
        await session.scalar(
            text("select count(*) from concepts where topic_id=:id"), {"id": topic}
        )
        == 1
    )


@pytest.mark.parametrize(
    "raw", [None, [], ["bad"], {"curriculum": {"references": "bad"}}]
)
async def test_malformed_drafts_remain_inspectable(api, session, draft, raw):
    rid = await rid_for(session, draft[1])
    await session.execute(
        text("update concept_revisions set body=cast(:body as jsonb) where id=:id"),
        {"id": rid, "body": json.dumps(raw)},
    )
    await session.commit()
    state = await detail(api, rid)
    assert state["body"] == raw and not state["validation"]["valid"]


async def test_read_models_do_not_take_write_locks(
    api, session, draft, sessionmaker_for_test
):
    rid = await rid_for(session, draft[1])
    async with sessionmaker_for_test() as reader:
        await reader.execute(text("set transaction read only"))
        assert (await editorial_queries.revision_detail(reader, rid))["id"] == rid
        assert (await editorial_queries.concept_detail(reader, draft[1]))[
            "id"
        ] == draft[1]


async def test_two_reviewers_stale_tab_and_revoked_receipt(api, session, draft):
    rid = await rid_for(session, draft[1])
    await act(api, rid, "submit")
    state = await detail(api, rid)
    uid, sid, _ = await test_editorial_api.enroll(
        api, session, ["review", "approve", "publish"]
    )
    await test_editorial_api.profile_and_approve(api, uid, sid)
    one = dict(
        action="approve_and_publish",
        expected_token=state["token"],
        request_id=str(uuid4()),
        note=NOTE,
        quality=review(),
    )
    results = await asyncio.gather(
        api.client.post(
            f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=one
        ),
        api.client.post(
            f"{ROOT}/revisions/{rid}/actions",
            headers=api.headers(uid, sid),
            json=one | {"request_id": str(uuid4())},
        ),
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    assert (await detail(api, rid))["status"] == "published"
    await session.execute(
        text("update editorial_memberships set status='revoked' where user_id=:uid"),
        {"uid": api.owner.id},
    )
    await session.commit()
    assert (
        await api.client.post(
            f"{ROOT}/revisions/{rid}/actions", headers=api.headers(), json=one
        )
    ).status_code == 403
