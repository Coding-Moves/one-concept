"""Published prerequisite text is unavailable when its taxonomy is retired."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content

api = content.api
editorial = content.editorial
draft = content.draft


@pytest.mark.parametrize("retired", ["topic", "subtopic"])
async def test_unavailable_prerequisite_blocks_preview_and_atomic_publication(
    api, session, draft, retired
):
    slug, cid = draft
    rid = await content.rid_for(session, cid)
    prereq_slug = "prereq-" + uuid4().hex
    tid = await session.scalar(
        text("""insert into topics(slug,name,is_active)
        values (:slug,'Prerequisite fixture',:active) returning id"""),
        {"slug": prereq_slug, "active": retired != "topic"},
    )
    sid = await session.scalar(
        text("""insert into subtopics(topic_id,slug,name,is_active)
        values (:tid,'core','Core',:active) returning id"""),
        {"tid": tid, "active": retired != "subtopic"},
    )
    await session.execute(
        text("""insert into concepts(topic_id,subtopic_id,slug,title,summary,example,status)
        values (:tid,:sid,:slug,'A distinct prerequisite','Prerequisite explanation',
        'Prerequisite example','published')"""),
        {"tid": tid, "sid": sid, "slug": prereq_slug},
    )
    await session.execute(
        text("""update concept_revisions set body=jsonb_set(body,
        '{curriculum,prerequisites}',cast(:p as jsonb)) where id=:id"""),
        {"id": rid, "p": json.dumps([prereq_slug])},
    )
    await session.commit()
    assert (await content.act(api, rid, "submit"))[0].status_code == 200
    state = await content.detail(api, rid)
    response, payload = await content.act(
        api, rid, "approve_and_publish", state["token"]
    )
    # Check the mutation before the preview, so the regression proves no bad publication.
    assert response.status_code == 409, response.text
    assert not state["validation"]["valid"]
    assert any(
        "prerequisite" in e["message"].lower() for e in state["validation"]["errors"]
    )
    assert (
        await session.scalar(
            text("select status from concept_revisions where id=:id"), {"id": rid}
        )
        == "pending_review"
    )
    assert (
        await session.scalar(
            text("select status from concepts where id=:id"), {"id": cid}
        )
        == "draft"
    )
    assert not await session.scalar(
        text("""select exists(select 1 from editorial_revision_events
        where revision_id=:id and action='approved')"""),
        {"id": rid},
    )
    assert not await session.scalar(
        text("""select exists(select 1 from editorial_request_receipts
        where request_id=:id)"""),
        {"id": payload["request_id"]},
    )
