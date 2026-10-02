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
