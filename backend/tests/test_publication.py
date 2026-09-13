import json
import uuid
from unittest.mock import AsyncMock

import pytest
from app.services import pool
from app.services.curriculum import (
    PlannedLesson,
    Subject,
    import_lessons,
    import_subjects,
)
from app.services.generation import GeneratedConcept
from app.services.publication import LessonBody, publish_revision, stage_revision
from sqlalchemy import text


@pytest.fixture
async def draft(session, monkeypatch, empty_generation_budget):
    slug = "editorial-" + uuid.uuid4().hex
    await import_subjects(session, [Subject(slug=slug, name="Editorial fixture")])
    data = {
        "objective": f"Explain and demonstrate {slug}",
        "difficulty": 1,
        "references": [
            {"title": "Python reference", "url": "https://docs.python.org/3/"}
        ],
    }
    await import_lessons(
        session,
        [
            PlannedLesson(
                slug=slug, topic_slug=slug, title=f"Lesson {slug}", curriculum=data
            )
        ],
    )
    tid = await session.scalar(
        text("select id from public.topics where slug=:s"), {"s": slug}
    )
    await session.commit()
    monkeypatch.setattr(
        pool,
        "generate_concept",
        AsyncMock(
            return_value=GeneratedConcept(
                summary="A useful explanation with a precise learning objective. " * 3,
                example="A concrete worked example that demonstrates the idea clearly.",
                model="fixture",
            )
        ),
    )
    cid = await pool.generate_one(session, "fixture", "fixture", tid, call_cap=10)
    yield slug, cid
    await session.rollback()
    await session.execute(
        text("update public.topics set is_active=false where id=:t"), {"t": tid}
    )
    await session.commit()


async def test_generated_drafts_require_review_and_publish_once(session, draft):
    slug, cid = draft
    row = (
        await session.execute(
            text("select status,content_version from public.concepts where id=:id"),
            {"id": cid},
        )
    ).one()
    assert tuple(row) == ("draft", 0)
    revision = await session.scalar(
        text("select id from public.concept_revisions where concept_id=:id"),
        {"id": cid},
    )
    with pytest.raises(ValueError, match="reviewer"):
        await publish_revision(session, revision, "", "looks good")
    assert (
        await publish_revision(
            session,
            revision,
            "Maintainer",
            "Checked explanation and example against the listed source.",
        )
        == 1
    )
    assert (
        await publish_revision(
            session,
            revision,
            "Maintainer",
            "Duplicate submission of the reviewed draft.",
        )
        == 1
    )
    await session.commit()
    assert (
        await session.scalar(
            text(
                "select content_version from public.concepts where slug=:s and status='published'"
            ),
            {"s": slug},
        )
        == 1
    )


async def test_corrections_preserve_text_until_review_and_reject_stale_versions(
    session, draft
):
    slug, cid = draft
    original = (
        await session.execute(
            text("select id,body from public.concept_revisions where concept_id=:id"),
            {"id": cid},
        )
    ).one()
    await publish_revision(
        session, original.id, "Maintainer", "Verified original text against sources."
    )
    body = LessonBody.model_validate(original.body)
    body.summary = (
        "A corrected explanation that remains available under the same identity. " * 3
    )
    first = await stage_revision(session, slug, body)
    second = await stage_revision(session, slug, body)
    assert (
        await session.scalar(
            text("select summary from public.concepts where id=:id"), {"id": cid}
        )
        == original.body["summary"].strip()
    )
    assert (
        await publish_revision(
            session,
            first,
            "Maintainer",
            "Verified the correction and its worked example.",
        )
        == 2
    )
    with pytest.raises(ValueError, match="stale"):
        await publish_revision(
            session,
            second,
            "Maintainer",
            "This older draft must not overwrite a newer correction.",
        )
    assert (
        await session.scalar(
            text("select id from public.concepts where slug=:s"), {"s": slug}
        )
        == cid
    )
    await session.commit()


async def test_retired_subject_cannot_publish_and_incomplete_metadata_cannot_bypass_review(
    session, draft
):
    slug, cid = draft
    revision = await session.scalar(
        text("select id from public.concept_revisions where concept_id=:id"),
        {"id": cid},
    )
    await session.execute(
        text("update public.topics set is_active=false where slug=:s"), {"s": slug}
    )
    with pytest.raises(ValueError, match="retired"):
        await publish_revision(
            session, revision, "Maintainer", "Verified source and example."
        )
    await session.execute(
        text("update public.topics set is_active=true where slug=:s"), {"s": slug}
    )
    await session.execute(
        text(
            "update public.concept_revisions set body=jsonb_set(body,'{curriculum}',cast(:data as jsonb)) where id=:id"
        ),
        {"id": revision, "data": json.dumps({})},
    )
    with pytest.raises(ValueError):
        await publish_revision(
            session,
            revision,
            "Maintainer",
            "Review must include a learning objective and references.",
        )
    await session.rollback()


async def test_legacy_correction_keeps_original_text_without_inventing_review(session, draft):
    slug, cid = draft
    original = (await session.execute(
        text("select id,body from public.concept_revisions where concept_id=:id"),
        {"id": cid},
    )).one()
    await publish_revision(session, original.id, "Maintainer", "Checked original against references.")
    # Simulate a migrated published lesson which predates revision records.
    await session.execute(text("delete from public.concept_revisions where concept_id=:id"), {"id": cid})
    body = LessonBody.model_validate(original.body)
    body.summary = "A corrected explanation with a stable concept identity. " * 3
    revision = await stage_revision(session, slug, body)
    assert await publish_revision(session, revision, "Maintainer", "Checked corrected example and source.") == 2
    legacy = (await session.execute(text("select body,reviewed_by,reviewed_at,review_note from public.concept_revisions where concept_id=:id and base_version=0"), {"id": cid})).one()
    assert legacy.body["summary"] == original.body["summary"].strip()
    assert legacy.reviewed_by is None and legacy.reviewed_at is None
    assert "original review was not recorded" in legacy.review_note
    await session.commit()
