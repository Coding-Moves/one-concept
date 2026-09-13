import uuid

import pytest
from app.services.curriculum import (
    PlannedLesson,
    Subject,
    import_lessons,
    import_subjects,
)
from sqlalchemy import text


def plan(slug, topic, **changes):
    data = {
        "slug": slug,
        "topic_slug": topic,
        "title": f"Learning {slug}",
        "curriculum": {
            "objective": f"Explain and demonstrate {slug}",
            "difficulty": 1,
            "references": [
                {"title": "Reference manual", "url": "https://docs.python.org/3/"}
            ],
        },
    }
    data.update(changes)
    return PlannedLesson.model_validate(data)


async def test_generic_subject_import_and_retirement_preserve_identity(session):
    slug = "subject-" + uuid.uuid4().hex
    subject = Subject(slug=slug, name="Future subject")
    await import_subjects(session, [subject])
    topic_id = await session.scalar(
        text("select id from public.topics where slug=:s"), {"s": slug}
    )
    lesson = plan("lesson-" + uuid.uuid4().hex, slug)
    assert await import_lessons(session, [lesson]) == []
    assert await import_lessons(session, [lesson]) == []
    await import_subjects(session, [subject.model_copy(update={"is_active": False})])
    assert (
        await session.scalar(
            text("select id from public.topics where slug=:s"), {"s": slug}
        )
        == topic_id
    )
    assert (
        await session.scalar(
            text("select count(*) from public.concept_backlog where topic_id=:t"),
            {"t": topic_id},
        )
        == 1
    )
    with pytest.raises(ValueError, match="retired"):
        await import_lessons(session, [plan("other-" + uuid.uuid4().hex, slug)])
    await session.rollback()


async def test_curriculum_rejects_cycles_missing_prerequisites_and_duplicate_objectives(
    session,
):
    slug = "subject-" + uuid.uuid4().hex
    await import_subjects(session, [Subject(slug=slug, name="Fixture subject")])
    first, second = (
        plan("one-" + uuid.uuid4().hex, slug),
        plan("two-" + uuid.uuid4().hex, slug),
    )
    first.curriculum.prerequisites = [second.slug]
    with pytest.raises(ValueError, match="Unknown prerequisite"):
        await import_lessons(session, [first])
    second.curriculum.prerequisites = [first.slug]
    with pytest.raises(ValueError, match="cycle"):
        await import_lessons(session, [first, second])
    first.curriculum.prerequisites = []
    second.curriculum.prerequisites = []
    second.curriculum.objective = first.curriculum.objective
    with pytest.raises(ValueError, match="Exact duplicate"):
        await import_lessons(session, [first, second])
    await session.rollback()


async def test_revising_a_failed_plan_preserves_attempts_and_requires_explicit_retry(
    session,
):
    slug = "revision-" + uuid.uuid4().hex
    await import_subjects(session, [Subject(slug=slug, name="Revision fixture")])
    item = plan(slug, slug)
    await import_lessons(session, [item])
    await session.execute(
        text(
            "update public.concept_backlog set attempts=3,status='failed' where slug=:s"
        ),
        {"s": slug},
    )
    item.angle = "Clarify the known validation failure without changing identity."
    with pytest.raises(ValueError, match="explicitly"):
        await import_lessons(session, [item])
    await import_lessons(session, [item], revise=True)
    row = (
        await session.execute(
            text(
                "select attempts,status,angle from public.concept_backlog where slug=:s"
            ),
            {"s": slug},
        )
    ).one()
    assert tuple(row) == (3, "failed", item.angle)
    await session.rollback()


async def test_checked_in_registry_and_extension_examples_import_without_changing_subject_ids(
    session,
):
    from pathlib import Path
    from pydantic import TypeAdapter

    folder = Path(__file__).resolve().parents[1] / "content"
    before = (
        await session.execute(
            text("select slug,id from public.topics where is_active order by slug")
        )
    ).all()
    subjects = TypeAdapter(list[Subject]).validate_json(
        (folder / "subjects.json").read_text()
    )
    lessons = TypeAdapter(list[PlannedLesson]).validate_json(
        (folder / "curriculum.example.json").read_text()
    )
    await import_subjects(session, subjects)
    assert len(subjects) == len(lessons) == 5
    await import_lessons(session, lessons)
    await import_lessons(session, lessons)
    after = (
        await session.execute(
            text("select slug,id from public.topics where is_active order by slug")
        )
    ).all()
    assert before == after
    await session.rollback()
