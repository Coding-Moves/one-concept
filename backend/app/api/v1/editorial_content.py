"""Private JSON API for One Concept Review; no provider call or rendering here."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.api.v1.editorial import Config, DB, User, PrivateRoute
from app.schemas.editorial_content import (
    ConceptAction,
    GenerationInput,
    RevisionAction,
    RevisionStatus,
    StageInput,
)
from app.services.editorial_accounts import authorize
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
    kind: Literal["revisions", "legacy"] = "revisions",
    status: RevisionStatus | None = None,
    topic_id: UUID | None = None,
    assignee_id: UUID | None = None,
    search: str = Query("", max_length=120),
    cursor: UUID | None = None,
    limit: int = Query(25, ge=1, le=100),
):
    await authorize(db, user, settings, "review")
    return await queries.queue(
        db, kind, status, topic_id, assignee_id, search, cursor, limit
    )


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
