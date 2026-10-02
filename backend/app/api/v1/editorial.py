"""Private account API for the future reviewer website (#278)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.deps import CurrentUser, get_current_user, get_db
from app.schemas.editorial import (
    AccessInput,
    InviteInput,
    Me,
    Member,
    MemberPage,
    ProfileInput,
    VersionInput,
)
from app.services.editorial_accounts import authorize
from app.services import editorial_management as management


HEADERS = {
    "Cache-Control": "no-store",
    "Vary": "Authorization",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                # Enforce the limit on actual streamed bytes, not a forgeable
                # Content-Length header. Cache only a bounded JSON body.
                if request.method in ("POST", "PUT", "PATCH"):
                    chunks, size = [], 0
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > 65536:
                            raise HTTPException(413, "Editorial request exceeds 64 KiB")
                        chunks.append(chunk)
                    request._body = b"".join(chunks)
                response = await handler(request)
            except HTTPException as exc:
                exc.headers = {**(exc.headers or {}), **HEADERS}
                raise
            except RequestValidationError as exc:
                # Do not echo accidentally pasted passwords or rejected input.
                return JSONResponse(
                    status_code=422,
                    headers=HEADERS,
                    content={
                        "detail": [
                            {
                                "loc": error["loc"],
                                "msg": error["msg"],
                                "type": error["type"],
                            }
                            for error in exc.errors()
                        ]
                    },
                )
            response.headers.update(HEADERS)
            return response

        return private_handler


router = APIRouter(prefix="/editorial", tags=["editorial"], route_class=PrivateRoute)
DB = Annotated[AsyncSession, Depends(get_db)]
User = Annotated[CurrentUser, Depends(get_current_user)]
Config = Annotated[Settings, Depends(get_settings)]


@router.get("/me", response_model=Me)
async def me(user: User, db: DB, settings: Config):
    member = await authorize(db, user, settings)
    return Me(
        member=member,
        onboarding_required=member.requested_name is None,
        name_approval_pending=member.requested_name != member.approved_name,
        mfa_required=user.aal != "aal2",
    )


@router.patch("/me/profile", response_model=Member)
async def profile(body: ProfileInput, user: User, db: DB, settings: Config):
    member = await management.request_profile(db, user, settings, body)
    await db.commit()
    return member


@router.get("/reviewers", response_model=MemberPage)
async def reviewers(
    user: User,
    db: DB,
    settings: Config,
    cursor: UUID | None = None,
    limit: int = Query(default=25, ge=1, le=100),
):
    await authorize(db, user, settings, "manage_reviewers")
    rows = (
        (
            await db.execute(
                text("""select * from editorial_memberships
        where (cast(:cursor as uuid) is null or user_id>cast(:cursor as uuid))
        order by user_id limit :limit"""),
                {"cursor": cursor, "limit": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    items = [Member.model_validate(dict(row)) for row in rows[:limit]]
    return MemberPage(
        items=items, next_cursor=items[-1].user_id if len(rows) > limit else None
    )


@router.post("/reviewers", response_model=Member, status_code=201)
async def invite(body: InviteInput, user: User, db: DB, settings: Config):
    member = await management.invite(db, user, settings, body)
    await db.commit()
    return member


@router.patch("/reviewers/{user_id}/access", response_model=Member)
async def access(
    user_id: UUID, body: AccessInput, user: User, db: DB, settings: Config
):
    member = await management.change_access(db, user, settings, user_id, body)
    await db.commit()
    return member


@router.post("/reviewers/{user_id}/approve-profile", response_model=Member)
async def approve_profile(
    user_id: UUID, body: VersionInput, user: User, db: DB, settings: Config
):
    member = await management.approve_profile(
        db, user, settings, user_id, body.expected_version
    )
    await db.commit()
    return member
