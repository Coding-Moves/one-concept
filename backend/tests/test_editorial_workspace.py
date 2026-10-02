"""Shared browser workspace read models and owner-only deadline commands."""

from uuid import uuid4

from sqlalchemy import text

from tests import test_editorial_content_api as content
from tests.test_editorial_api import enroll, profile_and_approve

editorial = content.editorial
api = content.api
draft = content.draft


async def test_deadline_filter_totals_and_stale_assignment(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    old = await content.detail(api, rid)
    response, command = await content.act(
        api,
        rid,
        "assign",
        token=old["token"],
        assignee_id=str(api.owner.id),
        review_due_at="2020-01-01T00:00:00Z",
    )
    assert response.status_code == 200, response.text
    replay = await api.client.post(
        f"{content.ROOT}/revisions/{rid}/actions", headers=api.headers(), json=command
    )
    assert replay.json() == response.json()
    assert (await content.act(api, rid, "comment", token=old["token"]))[
        0
    ].status_code == 409
    subtopic = await session.scalar(
        text("select subtopic_id from concepts where id=:id"), {"id": draft[1]}
    )
    params = {
        "subtopic_id": str(subtopic),
        "search": draft[0],
        "urgency": "overdue",
        "limit": 1,
    }
    result = (
        await api.client.get(
            f"{content.ROOT}/queue", headers=api.headers(), params=params
        )
    ).json()
    assert result["total"] == 1 and result["items"][0]["overdue"] is True
    params["cursor"] = str(rid)
    empty = (
        await api.client.get(
            f"{content.ROOT}/queue", headers=api.headers(), params=params
        )
    ).json()
    assert empty["total"] == 1 and empty["items"] == []
    response, _ = await content.act(
        api, rid, "assign", assignee_id=None, review_due_at=None
    )
    assert response.status_code == 200
    assert (await content.detail(api, rid))["review_due_at"] is None
    bad, _ = await content.act(api, rid, "assign", review_due_at="2030-01-01T00:00:00")
    assert bad.status_code == 422
    bad, _ = await content.act(api, rid, "comment", review_due_at=None)
    assert bad.status_code == 422


async def test_shared_approval_visible_to_second_reviewer(api, session, draft):
    uid, sid, _ = await enroll(api, session, ["review", "approve", "publish"])
    await profile_and_approve(api, uid, sid)
    rid = await content.rid_for(session, draft[1])
    await content.act(api, rid, "submit")
    stale = await content.detail(api, rid)
    approved, _ = await content.act(api, rid, "approved")
    assert approved.status_code == 200
    headers = api.headers(uid, sid)
    page = await api.client.get(
        f"{content.ROOT}/queue",
        headers=headers,
        params={"status": "approved", "search": draft[0]},
    )
    assert page.json()["total"] == 1
    assert page.json()["items"][0]["approved_by"]
    payload = {
        "request_id": str(uuid4()),
        "expected_token": stale["token"],
        "action": "approved",
        "note": content.NOTE,
        "quality": content.review(),
    }
    assert (
        await api.client.post(
            f"{content.ROOT}/revisions/{rid}/actions", headers=headers, json=payload
        )
    ).status_code == 409
    fresh = (
        await api.client.get(f"{content.ROOT}/revisions/{rid}", headers=headers)
    ).json()
    assert fresh["approved_by"] and fresh["status"] == "approved"
    payload.update(request_id=str(uuid4()), expected_token=fresh["token"])
    assert (
        await api.client.post(
            f"{content.ROOT}/revisions/{rid}/actions", headers=headers, json=payload
        )
    ).status_code == 409
    await content.act(api, rid, "publish")
    page = await api.client.get(
        f"{content.ROOT}/queue",
        headers=headers,
        params={"kind": "published", "search": draft[0]},
    )
    assert page.json()["total"] == 1 and page.json()["items"][0]["approved_by"]


async def test_taxonomy_requires_review_authority_and_deadlines_require_owner(
    api, session, draft
):
    uid, sid, _ = await enroll(api, session, ["review"])
    await profile_and_approve(api, uid, sid)
    rid = await content.rid_for(session, draft[1])
    detail = await content.detail(api, rid)
    payload = {
        "request_id": str(uuid4()),
        "expected_token": detail["token"],
        "action": "assign",
        "note": content.NOTE,
        "review_due_at": None,
    }
    assert (
        await api.client.post(
            f"{content.ROOT}/revisions/{rid}/actions",
            headers=api.headers(uid, sid),
            json=payload,
        )
    ).status_code == 403
    page = await api.client.get(
        f"{content.ROOT}/taxonomy?limit=1", headers=api.headers(uid, sid)
    )
    assert page.status_code == 200 and len(page.json()["items"]) == 1
    assert (
        await api.client.get(
            f"{content.ROOT}/taxonomy", headers=api.headers(aal="aal1")
        )
    ).status_code == 403
