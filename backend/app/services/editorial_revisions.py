"""Authenticated, exact-revision review evidence; callers own the transaction.

Always take the account lock before the catalog lock. No provider calls occur
here. Content edits create a new revision instead of changing reviewed evidence.
"""

import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import text

from app.services.content_quality import QualityReview
from app.services.curriculum import catalog_lock
from app.services.editorial_accounts import authorize
from app.services.publication import LessonBody

SNAPSHOT = "to_jsonb(c)-array['created_at','published_at','status']"


async def lock_reviewer(db, actor, settings, capability):
    await authorize(db, actor, settings, capability, mutation=True)
    await catalog_lock(db)
    # A catalog wait may itself span a session deadline.
    return await authorize(db, actor, settings, capability)


async def revision(db, revision_id, *, lock=True):
    row = (
        (
            await db.execute(
                text(f"""
        select r.*, c.content_version, c.status as concept_status,
          t.is_active as topic_active, s.is_active as subtopic_active,
          s.slug as subtopic_slug, {SNAPSHOT} as source_snapshot
        from concept_revisions r join concepts c on c.id=r.concept_id
        join topics t on t.id=c.topic_id join subtopics s on s.id=c.subtopic_id
        where r.id=:id {"for update of r,c,t,s" if lock else ""}
    """),
                {"id": revision_id},
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise ValueError("Unknown revision")
    return row


def current(row):
    if row["base_version"] != row["content_version"]:
        raise ValueError(
            "Revision is stale; prepare a new draft from the current version"
        )
    if (
        row["concept_status"] == "archived"
        or not row["topic_active"]
        or not row["subtopic_active"]
    ):
        raise ValueError("Cannot review or publish retired content")


async def event(db, row, member, action, note, quality=None):
    if len(note.strip()) < 10:
        raise ValueError("Record a substantive review note (at least 10 characters)")
    # Validation also protects internal callers from model_construct()/mutated models.
    quality_json = (
        QualityReview.model_validate(quality.model_dump()).model_dump_json()
        if quality is not None
        else None
    )
    return await db.scalar(
        text("""
        insert into editorial_revision_events
          (revision_id,concept_id,base_version,actor_id,registered_name,action,
           revision_body,source_snapshot,note,checklist_version,quality_review)
        values (:rid,:cid,:version,:actor,:name,:action,cast(:body as jsonb),
          cast(:source as jsonb),:note,:policy,cast(:quality as jsonb)) returning id
    """),
        {
            "rid": row["id"],
            "cid": row["concept_id"],
            "version": row["base_version"],
            "actor": member.user_id,
            "name": member.approved_name,
            "action": action,
            "body": json.dumps(row["body"]),
            "source": json.dumps(row["source_snapshot"]),
            "note": note.strip(),
            "policy": 1 if quality is not None else None,
            "quality": quality_json,
        },
    )


async def submit_revision(db, revision_id, actor, settings, note):
    member = await lock_reviewer(db, actor, settings, "review")
    row = await revision(db, revision_id)
    current(row)
    if row["status"] != "draft":
        raise ValueError(
            "Only a new draft can be submitted; corrections need a new revision"
        )
    try:
        body = LessonBody.model_validate(row["body"])
        if body.subtopic_slug != row["subtopic_slug"]:
            raise ValueError("Revision subtopic does not match the concept")
    except (ValidationError, ValueError):
        state = "validation_failed"
    else:
        state = "pending_review"
    await event(db, row, member, state, note)
    await db.execute(
        text("update concept_revisions set status=:state where id=:id"),
        {"state": state, "id": revision_id},
    )
    return state


async def decide_revision(db, revision_id, actor, settings, action, note, quality=None):
    if action not in ("approved", "changes_requested", "rejected", "retired"):
        raise ValueError("Unknown review decision")
    member = await lock_reviewer(
        db,
        actor,
        settings,
        "approve" if action in ("approved", "retired") else "review",
    )
    row = await revision(db, revision_id)
    if action != "retired":
        current(row)
    if action == "retired":
        allowed = (
            "draft",
            "validation_failed",
            "pending_review",
            "changes_requested",
            "approved",
            "rejected",
        )
    else:
        allowed = ("pending_review",)
    if row["status"] not in allowed:
        raise ValueError("Invalid revision transition; reload before reviewing")
    if action == "approved":
        body = LessonBody.model_validate(row["body"])
        if body.subtopic_slug != row["subtopic_slug"] or quality is None:
            raise ValueError(
                "Approval requires matching taxonomy and the complete quality checklist"
            )
    elif quality is not None:
        raise ValueError("Only approval records a completed checklist")
    eid = await event(db, row, member, action, note, quality)
    await db.execute(
        text("update concept_revisions set status=:state where id=:id"),
        {"state": action, "id": revision_id},
    )
    return eid


async def publish_reviewed_revision(
    db, revision_id, actor, settings, *, note="Published the exact authenticated approval."
):
    member = await lock_reviewer(db, actor, settings, "publish")
    row = await revision(db, revision_id)
    approval = (
        (
            await db.execute(
                text("""select * from editorial_revision_events
        where revision_id=:id and action='approved'"""),
                {"id": revision_id},
            )
        )
        .mappings()
        .first()
    )
    if approval is None:
        raise ValueError("Authenticated approval of this exact revision is required")
    if row["status"] == "published":
        # Historical retries report the already-published version, never republish.
        version = await db.scalar(
            text("""select content_version from editorial_publications
            where approval_id=:id"""),
            {"id": approval["id"]},
        )
        if version is None:
            raise ValueError("Published revision has no authenticated provenance")
        return version
    current(row)
    if row["status"] != "approved":
        raise ValueError("Only an approved, non-retired revision can be published")
    if (
        approval["revision_body"] != row["body"]
        or approval["base_version"] != row["base_version"]
        or approval["source_snapshot"] != row["source_snapshot"]
    ):
        raise ValueError(
            "Approved content or source version changed; prepare a new revision"
        )
    from app.services.publication import _apply_revision

    version = await _apply_revision(
        db,
        revision_id,
        approval["registered_name"],
        approval["note"],
        QualityReview.model_validate(approval["quality_review"]),
    )
    await db.execute(
        text(f"""insert into editorial_publications
        (concept_id,content_version,approval_id,snapshot)
        select c.id,c.content_version,:approval,{SNAPSHOT} from concepts c where c.id=:id"""),
        {"approval": approval["id"], "id": row["concept_id"]},
    )
    await event(db, row, member, "published", note)
    return version


async def attest_legacy_version(
    db,
    concept_id: UUID,
    version: int,
    actor,
    settings,
    note: str,
    quality: QualityReview,
):
    member = await lock_reviewer(db, actor, settings, "approve")
    # Making attribution visible is publication, even when the text is unchanged.
    await authorize(db, actor, settings, "publish")
    row = (
        (
            await db.execute(
                text(f"""select c.*,s.slug as subtopic_slug,
        {SNAPSHOT} as snapshot, t.is_active as topic_active,s.is_active as subtopic_active
        from concepts c join topics t on t.id=c.topic_id
        join subtopics s on s.id=c.subtopic_id where c.id=:id for update of c,t,s"""),
                {"id": concept_id},
            )
        )
        .mappings()
        .first()
    )
    if row is None or row["status"] != "published" or row["content_version"] != version:
        raise ValueError("Choose the exact current published legacy version")
    if not row["topic_active"] or not row["subtopic_active"]:
        raise ValueError("Cannot attest retired content")
    legacy = await db.scalar(
        text("""select snapshot from editorial_legacy_versions
        where concept_id=:id and content_version=:v"""),
        {"id": concept_id, "v": version},
    )
    if legacy != row["snapshot"]:
        raise ValueError(
            "Only the unchanged inventoried legacy version can be attested"
        )
    if await db.scalar(
        text("""select exists(select 1 from editorial_publications
        where concept_id=:id and content_version=:v)"""),
        {"id": concept_id, "v": version},
    ):
        raise ValueError("This version already has authenticated provenance")
    body = LessonBody.model_validate(
        {
            "title": row["title"],
            "summary": row["summary"],
            "example": row["example"],
            "subtopic_slug": row["subtopic_slug"],
            "curriculum": row["curriculum"],
            "learning_package": {"flashcard": row["flashcard"], "mcqs": row["mcqs"]},
            "model": row["model"],
            "prompt_version": row["prompt_version"],
        }
    )
    from app.services.publication import validate_candidate

    await validate_candidate(db, row["slug"], concept_id, body)
    eid = await event(
        db,
        {
            "id": None,
            "concept_id": concept_id,
            "base_version": version,
            "body": body.model_dump(mode="json"),
            "source_snapshot": row["snapshot"],
        },
        member,
        "attested",
        note,
        quality,
    )
    await db.execute(
        text("""insert into editorial_publications
        (concept_id,content_version,approval_id,snapshot) values (:id,:v,:a,cast(:body as jsonb))"""),
        {"id": concept_id, "v": version, "a": eid, "body": json.dumps(row["snapshot"])},
    )
    return eid


async def published_provenance(db, concept_id, version):
    """Only attribution matching the displayed current body; no legacy name fallback."""
    return (
        (
            await db.execute(
                text(f"""select e.actor_id as reviewer_id,
        e.registered_name,e.created_at as reviewed_at,p.content_version
        from editorial_publications p join editorial_revision_events e on e.id=p.approval_id
        join concepts c on c.id=p.concept_id
        where p.concept_id=:id and p.content_version=:v and c.content_version=:v
          and c.status='published' and p.snapshot={SNAPSHOT}
          and e.action in ('approved','attested')"""),
                {"id": concept_id, "v": version},
            )
        )
        .mappings()
        .first()
    )
