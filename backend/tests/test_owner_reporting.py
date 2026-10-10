from uuid import uuid4

import pytest
from sqlalchemy import text

from tests import test_editorial_api
from tests.test_editorial_api import auth_account, enroll, profile_and_approve

api = test_editorial_api.api
editorial = test_editorial_api.editorial


@pytest.mark.parametrize("path", ["overview", "reviewers", "operations", "events"])
async def test_owner_report_authority_and_private_headers(api, session, path):
    url = "/v1/editorial/owner/" + path
    assert (await api.client.get(url)).status_code == 401
    uid, sid, _ = await auth_account(session)
    assert (await api.client.get(url, headers=api.headers(uid, sid))).status_code == 403
    uid, sid, _ = await enroll(api, session)
    await profile_and_approve(api, uid, sid)
    assert (await api.client.get(url, headers=api.headers(uid, sid))).status_code == 403
    assert (
        await api.client.get(url, headers=api.headers(aal="aal1"))
    ).status_code == 403
    result = await api.client.get(url, headers=api.headers())
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    assert "Authorization" in result.headers["vary"]
    await session.execute(
        text("update editorial_memberships set status='revoked' where user_id=:id"),
        {"id": api.owner.id},
    )
    await session.commit()
    assert (await api.client.get(url, headers=api.headers())).status_code == 403


async def concept(session):
    tid, cid = uuid4(), uuid4()
    await session.execute(
        text("insert into topics(id,slug,name,is_active) values(:id,:slug,'Metrics fixture',false)"),
        {"id": tid, "slug": str(tid)},
    )
    await session.execute(
        text(
            "insert into concepts(id,topic_id,slug,title,summary) values(:id,:tid,:slug,'Fixture','Private lesson body')"
        ),
        {"id": cid, "tid": tid, "slug": str(cid)},
    )
    return cid


async def test_metrics_use_completion_time_utc_distinct_learners_and_exclude_editorial_only(
    api, session
):
    uid, _, _ = await auth_account(session)
    cid = await concept(session)
    await session.execute(
        text(
            "update profiles set created_at='2001-01-01T00:00:00Z' where id in (:uid,:owner)"
        ),
        {"uid": uid, "owner": api.owner.id},
    )
    await session.execute(
        text(
            "insert into user_concept_completions(user_id,concept_id,completed_at) values(:uid,:cid,'2001-01-02T23:59:00Z')"
        ),
        {"uid": uid, "cid": cid},
    )
    await session.execute(
        text(
            "insert into daily_reviews(user_id,concept_id,assigned_for,completed_at) values(:uid,:cid,'2001-01-02','2001-01-03T00:00:00Z')"
        ),
        {"uid": uid, "cid": cid},
    )
    await session.commit()
    out = await api.client.get(
        "/v1/editorial/owner/overview?start=2001-01-02&end=2001-01-02",
        headers=api.headers(),
    )
    assert out.status_code == 200, out.text
    assert out.json()["metrics"] == {
        "registered": 1,
        "new_registrations": 0,
        "active_day": 1,
        "active_week": 1,
        "active_month": 1,
        "lessons": 1,
        "reviews": 0,
    }
    assert out.json()["trend"] == [
        {"day": "2001-01-02", "lessons": 1, "reviews": 0, "active": 1}
    ]
    out = await api.client.get(
        "/v1/editorial/owner/overview?start=2001-01-02&end=2001-01-03",
        headers=api.headers(),
    )
    assert out.json()["metrics"]["active_week"] == 1
    assert out.json()["metrics"]["reviews"] == 1
    assert out.json()["trend"][1]["reviews"] == 1
    await session.execute(text("delete from auth.users where id=:id"), {"id": uid})
    await session.commit()
    out = await api.client.get(
        "/v1/editorial/owner/overview?start=2001-01-02&end=2001-01-03",
        headers=api.headers(),
    )
    assert out.json()["metrics"]["registered"] == 0


async def evidence(session, actor, cid, version, name):
    eid = uuid4()
    await session.execute(
        text("""insert into editorial_revision_events
      (id,concept_id,base_version,actor_id,registered_name,action,revision_body,source_snapshot,note,checklist_version,quality_review,created_at)
      values(:eid,:cid,:v,:actor,:name,'attested','{}','{}','secret note never returned',1,'{}','2002-01-01T12:00:00Z')"""),
        {"eid": eid, "cid": cid, "v": version, "actor": actor, "name": name},
    )
    await session.execute(
        text("""insert into editorial_publications(concept_id,content_version,approval_id,snapshot,recorded_at)
      values(:cid,:v,:eid,'{}','2002-01-01T12:01:00Z')"""),
        {"cid": cid, "v": version, "eid": eid},
    )
    return eid


async def test_reviewer_counts_versions_once_per_concept_and_preserves_signatures(
    api, session
):
    cid = await concept(session)
    await evidence(session, api.owner.id, cid, 1, "Historical Name")
    await evidence(session, api.owner.id, cid, 2, "Historical Name")
    await session.execute(
        text(
            "update editorial_memberships set approved_name='Renamed Owner' where user_id=:id"
        ),
        {"id": api.owner.id},
    )
    await session.commit()
    out = await api.client.get(
        "/v1/editorial/owner/reviewers?start=2002-01-01&end=2002-01-02",
        headers=api.headers(),
    )
    assert out.status_code == 200, out.text
    item = next(x for x in out.json()["items"] if x["id"] == str(api.owner.id))
    assert item["name"] == "Historical Name"
    assert (
        item["approval_events"] == 2
        and item["approved_concepts"] == 1
        and item["published_concepts"] == 1
    )
    assert "secret note" not in out.text and api.owner.email not in out.text
    assert item["rejections"] == 0
    out = await api.client.get(
        "/v1/editorial/owner/reviewers?limit=1", headers=api.headers()
    )
    seen = set()
    while True:
        body = out.json()
        for x in body["items"]:
            assert x["id"] not in seen
            seen.add(x["id"])
        if not body["next_cursor"]:
            break
        out = await api.client.get(
            "/v1/editorial/owner/reviewers",
            params={"limit": 1, "cursor": body["next_cursor"]},
            headers=api.headers(),
        )
    assert str(api.owner.id) in seen


async def test_event_projection_pagination_and_filters_never_return_payloads(
    api, session
):
    correlation = uuid4()
    await session.execute(
        text("""insert into owner_operation_events(service,code,severity,correlation_id)
        values('api','unexpected_failure','error',:cid),('reminders','completed','info',:cid)"""),
        {"cid": correlation},
    )
    cid = await concept(session)
    await evidence(session, api.owner.id, cid, 1, "Safe Reviewer")
    await session.commit()
    response = await api.client.get(
        "/v1/editorial/owner/events",
        params={
            "correlation": correlation.hex,
            "source": "api",
            "severity": "error",
            "search": "unexpected",
            "limit": 1,
        },
        headers=api.headers(),
    )
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["source"] == "api" and item["severity"] == "error"
    assert set(item) == {
        "key",
        "observed_at",
        "source",
        "action",
        "severity",
        "correlation_id",
    }
    assert len(response.json()["items"]) == 1 and response.json()["next_cursor"] is None
    response = await api.client.get(
        "/v1/editorial/owner/events?start=2002-01-01&end=2002-01-02&source=review&limit=1",
        headers=api.headers(),
    )
    keys = set()
    while True:
        body = response.json()
        assert (
            "secret note" not in response.text
            and "Private lesson body" not in response.text
        )
        for row in body["items"]:
            assert row["key"] not in keys
            keys.add(row["key"])
        if not body["next_cursor"]:
            break
        response = await api.client.get(
            "/v1/editorial/owner/events",
            params={
                "start": "2002-01-01",
                "end": "2002-01-02",
                "source": "review",
                "limit": 1,
                "cursor": body["next_cursor"],
            },
            headers=api.headers(),
        )
    assert len(keys) >= 1


async def test_operations_missing_and_stale_are_not_success(api, session):
    await session.execute(text("delete from owner_operation_events"))
    await session.commit()
    api.settings.owner_telemetry_enabled = True
    r = await api.client.get("/v1/editorial/owner/operations", headers=api.headers())
    assert r.status_code == 200, r.text
    assert all(
        w["status"] == "unavailable" and w["observation"] is None
        for w in r.json()["workers"]
    )
    await session.execute(
        text("""insert into owner_operation_events(service,code,severity,correlation_id,observed_at)
      values('reminders','completed','info',:id,now()-interval '2 hours')"""),
        {"id": uuid4()},
    )
    await session.commit()
    r = await api.client.get("/v1/editorial/owner/operations", headers=api.headers())
    assert r.json()["workers"][0]["status"] == "stale"
    assert r.json()["generation_enabled"] is False
    assert r.json()["editorial_auto_correction_enabled"] is False
    api.settings.generation_enabled = True
    r = await api.client.get("/v1/editorial/owner/operations", headers=api.headers())
    assert r.json()["editorial_auto_correction_enabled"] is True


@pytest.mark.parametrize(
    "query",
    [
        "start=2000-01-01&end=2001-01-01",
        "start=2001-02-01&end=2001-01-01",
        "end=2999-01-01",
        "end=0001-01-01",
        "limit=51",
        "cursor=garbage",
    ],
)
async def test_invalid_ranges_and_event_paging(api, query):
    r = await api.client.get(
        "/v1/editorial/owner/events?" + query, headers=api.headers()
    )
    assert r.status_code == 422, r.text


async def test_deleted_reviewer_remains_visible_when_publication_follows_approval(
    api, session
):
    uid, _, _ = await auth_account(session)
    cid = await concept(session)
    await evidence(session, uid, cid, 1, "Departed Reviewer")
    # Keep immutable approval intact; insert a later publication for a second version.
    eid = uuid4()
    await session.execute(
        text("""insert into editorial_revision_events
      (id,concept_id,base_version,actor_id,registered_name,action,revision_body,source_snapshot,note,checklist_version,quality_review,created_at)
      values(:eid,:cid,2,:uid,'Departed Reviewer','attested','{}','{}','private review note',1,'{}','2002-01-01T12:00:00Z')"""),
        {"eid": eid, "cid": cid, "uid": uid},
    )
    await session.execute(
        text("""insert into editorial_publications(concept_id,content_version,approval_id,snapshot,recorded_at)
      values(:cid,2,:eid,'{}','2002-02-01T12:00:00Z')"""),
        {"cid": cid, "eid": eid},
    )
    await session.execute(text("delete from auth.users where id=:uid"), {"uid": uid})
    await session.commit()
    response = await api.client.get(
        "/v1/editorial/owner/reviewers?start=2002-02-01&end=2002-02-01",
        headers=api.headers(),
    )
    assert response.status_code == 200, response.text
    row = next(x for x in response.json()["items"] if x["id"] == str(uid))
    assert row["name"] == "Departed Reviewer" and row["status"] == "deleted"
    assert row["approval_events"] == 0 and row["published_concepts"] == 1


async def test_worker_observations_do_not_depend_on_api_telemetry_switch(api, session):
    await session.execute(text("delete from owner_operation_events"))
    await session.execute(
        text("""insert into owner_operation_events(service,code,severity,correlation_id)
          values('reminders','completed','info',:id)"""),
        {"id": uuid4()},
    )
    await session.commit()
    # Workers and the API have independent environment variables on Railway.
    api.settings.owner_telemetry_enabled = False
    response = await api.client.get("/v1/editorial/owner/operations", headers=api.headers())
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["telemetry_enabled"] is False
    assert report["workers"][0]["status"] == "completed"
    assert report["workers"][1]["status"] == "unavailable"
