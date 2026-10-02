"""Private JSON API for One Concept Review; no provider call or rendering here."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.api.v1.editorial import Config, DB, User, PrivateRoute
from app.schemas.editorial_content import (
    ConceptAction,
    VersionCommand,
    GenerationJobStatus,
    GenerationInput,
    RevisionAction,
    RevisionStatus,
    StageInput,
)
from app.services.editorial_accounts import authorize
from app.services import editorial_generation as generation_jobs
from app.services.editorial_generation_status import generation_status
from app.services import editorial_queries as queries
from app.services import editorial_workflow as workflow

router = APIRouter(
    prefix="/editorial", tags=["editorial content"], route_class=PrivateRoute
)


@router.get("/queue")
async def queue(
    user: User,
    db: DB,
    settings: Config,
    kind: Literal["revisions", "legacy", "published"] = "revisions",
    status: RevisionStatus | None = None,
    topic_id: UUID | None = None,
    assignee_id: UUID | None = None,
    subtopic_id: UUID | None = None,
    urgency: Literal["overdue", "scheduled", "unscheduled"] | None = None,
    search: str = Query("", max_length=120),
    cursor: UUID | None = None,
    limit: int = Query(25, ge=1, le=100),
):
    await authorize(db, user, settings, "review")
    return await queries.queue(
        db,
        kind,
        status,
        topic_id,
        assignee_id,
        search,
        cursor,
        limit,
        subtopic_id,
        urgency,
    )


@router.get("/taxonomy")
async def taxonomy(
    user: User,
    db: DB,
    settings: Config,
    cursor: UUID | None = None,
    limit: int = Query(100, ge=1, le=100),
):
    await authorize(db, user, settings, "review")
    return await queries.taxonomy(db, cursor, limit)


@router.get("/revisions/{rid}")
async def revision(rid: UUID, user: User, db: DB, settings: Config):
    await authorize(db, user, settings, "review")
    try:
        return await queries.revision_detail(db, rid)
    except ValueError:
        raise HTTPException(404, "Revision not found") from None


@router.get("/concepts/{cid}")
async def concept(cid: UUID, user: User, db: DB, settings: Config):
    await authorize(db, user, settings, "review")
    return await queries.concept_detail(db, cid)


@router.get("/concepts/{cid}/revisions")
async def history(
    cid: UUID,
    user: User,
    db: DB,
    settings: Config,
    cursor: UUID | None = None,
    limit: int = Query(25, ge=1, le=100),
):
    await authorize(db, user, settings, "review")
    return await queries.history(db, cid, cursor, limit)


@router.get("/concepts/{cid}/timeline")
async def timeline(
    cid: UUID,
    user: User,
    db: DB,
    settings: Config,
    cursor: str | None = Query(None, max_length=256),
    limit: int = Query(25, ge=1, le=100),
):
    await authorize(db, user, settings, "review")
    return await queries.timeline(db, cid, cursor, limit)


@router.get("/activity")
async def activity(
    user: User,
    db: DB,
    settings: Config,
    cursor: UUID | None = None,
    topic_id: UUID | None = None,
    limit: int = Query(25, ge=1, le=100),
):
    await authorize(db, user, settings, "manage_reviewers")
    rows = (
        (
            await db.execute(
                text("""select * from editorial_workflow_events
        where (cast(:cursor as uuid) is null or id>:cursor)
          and (cast(:topic as uuid) is null or topic_id=:topic)
        order by id limit :take"""),
                {"cursor": cursor, "topic": topic_id, "take": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    return {
        "items": [dict(r) for r in rows[:limit]],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


async def execute(db, operation):
    try:
        result = await operation
        await db.commit()
        return result
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(
            409, detail={"code": "review_conflict", "message": str(exc)}
        ) from None
    except Exception:
        await db.rollback()
        raise


@router.post("/revisions/{rid}/actions")
async def action(rid: UUID, body: RevisionAction, user: User, db: DB, settings: Config):
    return await execute(db, workflow.revision_action(db, user, settings, rid, body))


@router.post("/concepts/{cid}/revisions", status_code=201)
async def stage(cid: UUID, body: StageInput, user: User, db: DB, settings: Config):
    return await execute(db, workflow.stage(db, user, settings, cid, body))


@router.post("/concepts/{cid}/actions")
async def concept_action(
    cid: UUID, body: ConceptAction, user: User, db: DB, settings: Config
):
    return await execute(db, workflow.concept_action(db, user, settings, cid, body))


@router.post("/generation-requests", status_code=202)
async def generation(body: GenerationInput, user: User, db: DB, settings: Config):
    return await execute(db, workflow.request_generation(db, user, settings, body))


@router.post("/revisions/{rid}/generation-requests", status_code=202)
async def request_ai_revision(
    rid: UUID, body: VersionCommand, user: User, db: DB, settings: Config
):
    return await execute(
        db, generation_jobs.request_revision(db, user, settings, rid, body)
    )


@router.get("/generation-jobs")
async def generation_jobs_list(
    user: User,
    db: DB,
    settings: Config,
    status: GenerationJobStatus | None = None,
    topic_id: UUID | None = None,
    cursor: UUID | None = None,
    limit: int = Query(25, ge=1, le=100),
):
    await authorize(db, user, settings, "review")
    rows = (
        (
            await db.execute(
                text("""select * from editorial_generation_jobs
      where (cast(:status as text) is null or status=:status)
        and (cast(:tid as uuid) is null or topic_id=:tid)
        and (cast(:cursor as uuid) is null or id>:cursor)
      order by id limit :take"""),
                {
                    "status": status,
                    "tid": topic_id,
                    "cursor": cursor,
                    "take": limit + 1,
                },
            )
        )
        .mappings()
        .all()
    )
    return {
        "items": [generation_jobs.visible(r) for r in rows[:limit]],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


@router.get("/generation-jobs/{jid}")
async def generation_job(jid: UUID, user: User, db: DB, settings: Config):
    await authorize(db, user, settings, "review")
    return generation_jobs.visible(await generation_jobs.get_job(db, jid))


@router.post("/generation-jobs/{jid}/cancel")
async def cancel_generation(
    jid: UUID, body: VersionCommand, user: User, db: DB, settings: Config
):
    return await execute(db, generation_jobs.cancel(db, user, settings, jid, body))


@router.get("/generation-supply/{tid}")
async def generation_supply(tid: UUID, user: User, db: DB, settings: Config):
    await authorize(db, user, settings, "review")
    return await generation_status(db, tid, settings)
