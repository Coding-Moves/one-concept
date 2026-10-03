"""Owner-only reporting; mutations remain in their existing audited workflows."""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api.v1.editorial import Config, DB, User, PrivateRoute
from app.services.editorial_accounts import authorize
from app.services import owner_reporting as reports

router = APIRouter(prefix="/editorial/owner", tags=["owner"], route_class=PrivateRoute)


async def guard(db, user, settings):
    # Existing explicit administrator capability, not ordinary review permission.
    await authorize(db, user, settings, "manage_reviewers")
    await db.execute(text("set local statement_timeout='5s'"))
    await db.execute(text("set local timezone='UTC'"))


@router.get("/overview")
async def overview(
    user: User,
    db: DB,
    settings: Config,
    start: date | None = None,
    end: date | None = None,
):
    await guard(db, user, settings)
    return await reports.overview(db, reports.window(start, end))


@router.get("/reviewers")
async def reviewers(
    user: User,
    db: DB,
    settings: Config,
    start: date | None = None,
    end: date | None = None,
    cursor: UUID | None = None,
    limit: int = Query(25, ge=1, le=50),
):
    await guard(db, user, settings)
    return await reports.reviewers(db, reports.window(start, end), cursor, limit)


@router.get("/operations")
async def operations(user: User, db: DB, settings: Config):
    await guard(db, user, settings)
    return await reports.operations(db, settings)


@router.get("/events")
async def events(
    user: User,
    db: DB,
    settings: Config,
    start: date | None = None,
    end: date | None = None,
    source: Literal["api", "reminders", "pool_topup", "review", "workflow", "account"]
    | None = None,
    severity: Literal["info", "error"] | None = None,
    search: str | None = Query(None, max_length=80),
    correlation: UUID | None = None,
    cursor: str | None = Query(None, max_length=140),
    limit: int = Query(25, ge=1, le=50),
):
    await guard(db, user, settings)
    return await reports.events(
        db,
        reports.window(start, end),
        source,
        severity,
        search,
        correlation,
        cursor,
        limit,
    )
