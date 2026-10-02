import json

import pytest
from sqlalchemy import text

from app.services.publication import LessonBody
from app.workers import rewrite_catalog
from tests import test_publication
from tests.test_content_quality import package

draft = test_publication.draft


@pytest.mark.parametrize(
    "state", ["pending_review", "changes_requested", "validation_failed", "approved"]
)
async def test_rewrite_worker_does_not_reclaim_active_review(session, draft, state):
    cid = draft[1]
    await session.execute(
        text("update concepts set status='published',content_version=1 where id=:id"),
        {"id": cid},
    )
    await session.execute(
        text("update concept_revisions set status=:state where concept_id=:id"),
        {"id": cid, "state": state},
    )
    assert cid not in [
        row.id
        for row in (
            await session.execute(rewrite_catalog._TODO, {"pv": "new-prompt"})
        ).all()
    ]
    assert (
        await session.scalar(rewrite_catalog._CLAIM, {"id": cid, "version": 1}) is None
    )


async def test_rewrite_worker_stages_valid_package_without_publishing(session, draft):
    cid = draft[1]
    rid = await session.scalar(
        text("select id from concept_revisions where concept_id=:id"), {"id": cid}
    )
    original = await session.scalar(
        text("select summary from concepts where id=:id"), {"id": cid}
    )
    await session.execute(
        text("update concept_revisions set status='generating' where id=:id"),
        {"id": rid},
    )
    await session.execute(
        rewrite_catalog._UPDATE,
        {
            "revision": rid,
            "summary": "An independently reviewed correction with a complete learning package. "
            * 3,
            "example": "A worked example showing how this concept applies in everyday use.",
            "subtopic_slug": "foundations",
            "model": "fixture",
            "pv": "next",
            "learning_package": json.dumps(package()),
        },
    )
    row = (
        await session.execute(
            text("select body,status from concept_revisions where id=:id"), {"id": rid}
        )
    ).one()
    assert row.status == "draft"
    assert len(LessonBody.model_validate(row.body).learning_package.mcqs) == 3
    assert (
        await session.scalar(
            text("select summary from concepts where id=:id"), {"id": cid}
        )
        == original
    )
