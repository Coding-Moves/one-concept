"""Demand must use the same inventory as the worker and report durable truth."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from app.services.curriculum import (
    PlannedLesson,
    Subtopic,
    import_lessons,
    import_subtopics,
)
from tests import test_editorial_content_api as content

api = content.api
editorial = content.editorial
draft = content.draft


@pytest.mark.parametrize("retired_inventory", [False, True])
@pytest.mark.parametrize("existing_target", [None, 10])
async def test_demand_ignores_retired_inventory_and_reports_saved_target(
    api, session, draft, retired_inventory, existing_target
):
    slug, cid = draft
    topic = await session.scalar(
        text("select topic_id from concepts where id=:id"), {"id": cid}
    )
    body = (await content.detail(api, await content.rid_for(session, cid)))["body"]
    await import_lessons(
        session,
        [
            PlannedLesson(
                slug="next-" + slug,
                topic_slug=slug,
                subtopic_slug="foundations",
                title="Next distinct lesson " + slug,
                curriculum=body["curriculum"]
                | {"objective": "Explain the next independent fixture concept " + slug},
            )
        ],
    )
    if retired_inventory:
        await import_subtopics(
            session,
            [
                Subtopic(
                    topic_slug=slug,
                    slug="retired",
                    name="Retired",
                    is_active=False,
                )
            ],
        )
        await session.execute(
            text("""insert into concepts
            (topic_id,subtopic_id,slug,title,summary,example,status)
            select topic_id,(select id from subtopics where topic_id=:topic and slug='retired'),
              :slug,title,summary,example,'draft' from concepts where id=:id"""),
            {"topic": topic, "slug": "retired-" + slug, "id": cid},
        )
    if existing_target:
        await session.execute(
            text("""insert into content_supply_targets
            (topic_id,target_count,expires_at) values (:id,:target,now()+interval '1 day')"""),
            {"id": topic, "target": existing_target},
        )
    await session.commit()
    api.settings.generation_enabled = True
    payload = dict(
        request_id=str(uuid4()), topic_id=str(topic), count=1, note=content.NOTE
    )
    response = await api.client.post(
        f"{content.ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert response.status_code == 202, response.text
    saved = await session.scalar(
        text("select target_count from content_supply_targets where topic_id=:id"),
        {"id": topic},
    )
    # One active concept + one requested, unless pre-existing demand was larger.
    assert saved == (existing_target or 2)
    assert response.json()["target"] == saved
    event = await session.scalar(
        text("select details from editorial_workflow_events where id=:id"),
        {"id": response.json()["event_id"]},
    )
    assert event["target"] == saved
    again = await api.client.post(
        f"{content.ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert again.json() == response.json()


async def test_full_review_queue_blocks_demand_and_retirement_releases_capacity(
    api, session, draft
):
    slug, cid = draft
    topic = await session.scalar(
        text("select topic_id from concepts where id=:id"), {"id": cid}
    )
    body = (await content.detail(api, await content.rid_for(session, cid)))["body"]
    await import_lessons(
        session,
        [
            PlannedLesson(
                slug="next-" + slug,
                topic_slug=slug,
                subtopic_slug="foundations",
                title="Next lesson " + slug,
                curriculum=body["curriculum"]
                | {"objective": "Explain the next planned lesson " + slug},
            )
        ],
    )
    await session.commit()
    api.settings.generation_enabled = True
    api.settings.content_review_backlog_limit = 1
    payload = dict(
        request_id=str(uuid4()), topic_id=str(topic), count=10, note=content.NOTE
    )
    response = await api.client.post(
        f"{content.ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert response.status_code == 409 and "backlog is full" in response.text
    status = (
        await api.client.get(
            f"{content.ROOT}/generation-supply/{topic}", headers=api.headers()
        )
    ).json()
    assert status["review_blocked"] and status["drafts"] == 1 and status["pending"] == 1
    concept = (
        await api.client.get(f"{content.ROOT}/concepts/{cid}", headers=api.headers())
    ).json()
    retired = await api.client.post(
        f"{content.ROOT}/concepts/{cid}/actions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": concept["token"],
            "action": "retire",
            "note": content.NOTE,
        },
    )
    assert retired.status_code == 200, retired.text
    response = await api.client.post(
        f"{content.ROOT}/generation-requests", headers=api.headers(), json=payload
    )
    assert response.status_code == 202 and response.json()["target"] == 1


async def test_empty_curriculum_surfaces_planning_without_inventing_work(
    api, session, draft
):
    cid = draft[1]
    topic = await session.scalar(
        text("select topic_id from concepts where id=:id"), {"id": cid}
    )
    await session.commit()
    api.settings.generation_enabled = True
    response = await api.client.post(
        f"{content.ROOT}/generation-requests",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "topic_id": str(topic),
            "count": 5,
            "note": content.NOTE,
        },
    )
    assert response.status_code == 409 and "plan lessons" in response.text
    status = (
        await api.client.get(
            f"{content.ROOT}/generation-supply/{topic}", headers=api.headers()
        )
    ).json()
    assert status["planning_required"] and status["pending"] == 0


async def test_spent_pending_curriculum_is_not_eligible_manual_demand(
    api, session, draft
):
    slug, cid = draft
    tid = await session.scalar(
        text("select topic_id from concepts where id=:id"), {"id": cid}
    )
    await session.execute(
        text("""insert into concept_backlog(topic_id,subtopic_id,slug,title,attempts,status)
      select topic_id,subtopic_id,:slug,'Spent curriculum',3,'pending' from concepts where id=:id"""),
        {"id": cid, "slug": "spent-" + slug},
    )
    await session.commit()
    api.settings.generation_enabled = True
    response = await api.client.post(
        f"{content.ROOT}/generation-requests",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "topic_id": str(tid),
            "count": 1,
            "note": content.NOTE,
        },
    )
    assert response.status_code == 409 and "plan lessons" in response.text
