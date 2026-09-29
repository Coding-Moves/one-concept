"""Explicit review gates and version-safe corrections for the shared library."""

import uuid

from pydantic import Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.content_quality import LearningPackage, QualityReview
from app.services.curriculum import (
    Curriculum,
    StrictModel,
    catalog_lock,
    normalized,
    validate_graph,
)


class LessonBody(StrictModel):
    title: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=100, max_length=600)
    example: str = Field(min_length=40, max_length=500)
    subtopic_slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=120)
    curriculum: Curriculum
    learning_package: LearningPackage
    model: str | None = None
    prompt_version: str | None = None


async def stage_revision(
    session: AsyncSession, slug: str, body: LessonBody
) -> uuid.UUID:
    """Leave the published text intact until this exact draft passes review."""
    await catalog_lock(session)
    concept = (
        await session.execute(
            text(
                """select c.id,c.content_version,s.slug as subtopic_slug
                  from public.concepts c join public.subtopics s on s.id=c.subtopic_id
                 where c.slug=:s for update of c"""
            ),
            {"s": slug},
        )
    ).first()
    if concept is None:
        raise ValueError("Unknown concept")
    if body.subtopic_slug != concept.subtopic_slug:
        raise ValueError("A revision cannot change a concept's approved subtopic")
    await validate_graph(session, {slug: body.curriculum.model_dump(mode="json")})
    return await session.scalar(
        text("""insert into public.concept_revisions
      (concept_id,base_version,body) values (:id,:v,cast(:body as jsonb)) returning id"""),
        {
            "id": concept.id,
            "v": concept.content_version,
            "body": body.model_dump_json(),
        },
    )


async def publish_revision(
    session: AsyncSession, revision_id: uuid.UUID, reviewer: str, note: str,
    quality_review: QualityReview,
) -> int:
    if not reviewer.strip() or len(note.strip()) < 10:
        raise ValueError(
            "Record the reviewer and a substantive correctness/source review note"
        )
    await catalog_lock(session)
    row = (
        await session.execute(
            text("""select r.*,c.slug,c.content_version,t.is_active,s.slug as subtopic_slug,
              s.is_active as subtopic_active
      from public.concept_revisions r join public.concepts c on c.id=r.concept_id
      join public.topics t on t.id=c.topic_id
      join public.subtopics s on s.id=c.subtopic_id
      where r.id=:id for update of r,c,t,s"""),
            {"id": revision_id},
        )
    ).first()
    if row is None:
        raise ValueError("Unknown revision")
    if row.status == "published":
        return row.base_version + 1  # idempotent retries never publish twice
    if row.status != "draft" or row.base_version != row.content_version:
        raise ValueError(
            "Revision is rejected or stale; prepare a new draft from the current version"
        )
    if not row.is_active:
        raise ValueError("Cannot publish into a retired subject")
    if not row.subtopic_active:
        raise ValueError("Cannot publish into a retired subtopic")
    body = LessonBody.model_validate(row.body)
    if body.subtopic_slug != row.subtopic_slug:
        raise ValueError("Revision subtopic does not match the concept")
    await validate_graph(session, {row.slug: body.curriculum.model_dump(mode="json")})
    # A prerequisite must be available before a dependent lesson can be published.
    for slug in body.curriculum.prerequisites:
        if not await session.scalar(
            text(
                "select exists(select 1 from public.concepts where slug=:s and status='published')"
            ),
            {"s": slug},
        ):
            raise ValueError(f"Publish prerequisite {slug} first")
    others = (
        await session.execute(
            text(
                "select slug,title,curriculum from public.concepts where id<>:id and status='published'"
            ),
            {"id": row.concept_id},
        )
    ).all()
    for other in others:
        if normalized(other.title) == normalized(body.title) or normalized(
            other.curriculum.get("objective", "")
        ) == normalized(body.curriculum.objective):
            raise ValueError(
                f"Exact duplicate of {other.slug}; resolve overlap before publication"
            )
    # Preserve the pre-correction version, including migrated seed lessons that
    # predate editorial records. Do not invent an original reviewer or date.
    await session.execute(
        text("""insert into public.concept_revisions
      (concept_id,base_version,body,status,review_note)
      select c.id,c.content_version-1,jsonb_build_object('title',c.title,
        'summary',c.summary,'example',c.example,'curriculum',c.curriculum,
        'subtopic_slug',s.slug,
        'model',c.model,'prompt_version',c.prompt_version),'published',
        'Legacy version captured before correction; original review was not recorded.'
      from public.concepts c join public.subtopics s on s.id=c.subtopic_id
      where c.id=:id and c.content_version>0
      and not exists(select 1 from public.concept_revisions r where r.concept_id=c.id
        and r.status='published' and r.base_version=c.content_version-1)"""),
        {"id": row.concept_id},
    )
    await session.execute(
        text("""update public.concepts set title=:title,summary=:summary,
      example=:example,curriculum=cast(:curriculum as jsonb),difficulty=:difficulty,
      model=:model,prompt_version=:prompt_version,content_version=content_version+1,
      status='published',published_at=now() where id=:id"""),
        {
            "id": row.concept_id,
            "title": body.title,
            "summary": body.summary,
            "example": body.example,
            "curriculum": body.curriculum.model_dump_json(),
            "difficulty": body.curriculum.difficulty,
            "model": body.model,
            "prompt_version": body.prompt_version,
        },
    )
    await session.execute(
        text("""update public.concept_revisions set status='published',
      reviewed_by=:reviewer,review_note=:note,quality_review=cast(:quality_review as jsonb),reviewed_at=now() where id=:id"""),
        {"id": revision_id, "reviewer": reviewer.strip(), "note": note.strip(),
         "quality_review": quality_review.model_dump_json()},
    )
    return row.content_version + 1


async def retry_failed(
    session: AsyncSession, slug: str, operator: str, reason: str
) -> None:
    """Grant one audited retry after correcting a cause; never reset lifetime attempts."""
    if not operator.strip() or len(reason.strip()) < 10:
        raise ValueError("Record an operator and the corrected cause")
    row = (
        await session.execute(
            text("""select b.id,b.attempts from public.concept_backlog b
      join public.topics t on t.id=b.topic_id
      join public.subtopics s on s.id=b.subtopic_id
      where b.slug=:s and b.status='failed' and t.is_active and s.is_active
      for update of b"""),
            {"s": slug},
        )
    ).first()
    if row is None:
        raise ValueError("Choose a failed item in an active subject")
    if await session.scalar(
        text("select exists(select 1 from public.concepts where slug=:s)"), {"s": slug}
    ):
        raise ValueError("Slug already exists; correct the existing draft instead")
    # Each grant permits one further attempt, while preserving attempts as history.
    await session.execute(
        text("""insert into public.content_retry_log(backlog_id,operator,reason)
      values (:id,:operator,:reason)"""),
        {"id": row.id, "operator": operator, "reason": reason},
    )
    await session.execute(
        text(
            "update public.concept_backlog set status='pending',claimed_at=null where id=:id"
        ),
        {"id": row.id},
    )
