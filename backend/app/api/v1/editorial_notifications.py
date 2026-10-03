"""Owner-only delivery operations; reviewer-controlled IANA display timezone."""

from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import text

from app.api.v1.editorial import DB, User, Config, PrivateRoute
from app.schemas.editorial import VersionInput
from app.services.editorial_accounts import authorize, audit, check_version, membership
from app.services import editorial_notifications as notices, editorial_mail as mail

router = APIRouter(prefix="/editorial", tags=["editorial"], route_class=PrivateRoute)


class PolicyInput(VersionInput):
    deadline_hours: int = Field(ge=1, le=720, strict=True)
    reminder_hours: int = Field(ge=1, le=168, strict=True)
    max_reminders: int = Field(ge=0, le=10, strict=True)


class TimezoneInput(VersionInput):
    timezone: str = Field(max_length=80)

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Enter an IANA timezone such as Asia/Karachi") from None
        return value


class RetryInput(VersionInput):
    # Version is the durable attempt count, never a reset of the retry budget.
    pass


@router.patch("/me/notification-timezone")
async def timezone(body: TimezoneInput, user: User, db: DB, settings: Config):
    member = await authorize(db, user, settings, mutation=True)
    check_version(member, body.expected_version)
    await db.execute(
        text("""update editorial_memberships set notification_timezone=:tz,
        version=version+1,updated_at=now() where user_id=:id"""),
        {"id": user.id, "tz": body.timezone},
    )
    await audit(
        db, user.id, user.id, "notification_timezone", {"timezone": body.timezone}
    )
    member = await membership(db, user.id)
    await db.commit()
    return member


@router.get("/notifications")
async def overview(
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
                text("""select b.id,b.recipient_id,b.status,b.attempts,b.failure_code,b.created_at,b.sent_at,
        m.approved_name as recipient_name from editorial_email_batches b
        left join editorial_memberships m on m.user_id=b.recipient_id
        where (cast(:cursor as uuid) is null or b.id>cast(:cursor as uuid))
        order by b.id limit :limit"""),
                {"cursor": cursor, "limit": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    overdue = await db.scalar(
        text("""select count(*) from concept_revisions r join concepts c on c.id=r.concept_id
        where r.status in ('draft','pending_review') and r.review_due_at<now()
        and r.base_version=c.content_version and c.status<>'archived'""")
    )
    counts = dict(
        (
            await db.execute(
                text(
                    "select status,count(*) from editorial_email_batches group by status"
                )
            )
        ).all()
    )
    used = await db.scalar(
        text(
            "select count(*) from editorial_email_attempts where started_at>now()-interval '24 hours'"
        )
    )
    return {
        "policy": await notices.policy(db),
        "setup_status": mail.setup_status(settings),
        "daily_cap": settings.editorial_email_daily_cap,
        "attempts_last_24h": used,
        "overdue": overdue,
        "counts": counts,
        "items": [dict(r) for r in rows[:limit]],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


@router.patch("/notifications/policy")
async def policy(body: PolicyInput, user: User, db: DB, settings: Config):
    await authorize(db, user, settings, "manage_reviewers", mutation=True)
    await notices.locks(db)
    current = await notices.policy(db)
    if current["version"] != body.expected_version:
        raise HTTPException(409, "Policy changed; refresh before saving")
    values = body.model_dump(exclude={"expected_version"})
    await db.execute(
        text("""update editorial_notification_policy set version=version+1,
        deadline_hours=:deadline_hours,reminder_hours=:reminder_hours,max_reminders=:max_reminders"""),
        values,
    )
    await audit(db, user.id, user.id, "notification_policy", values)
    result = await notices.policy(db)
    await db.commit()
    return result


@router.post("/notifications/{batch_id}/retry")
async def retry(batch_id: UUID, body: RetryInput, user: User, db: DB, settings: Config):
    await authorize(db, user, settings, "manage_reviewers", mutation=True)
    await notices.locks(db)
    if mail.setup_status(settings) != "ready":
        raise HTTPException(409, "Complete sender setup before retrying")
    row = (
        (
            await db.execute(
                text("select * from editorial_email_batches where id=:id for update"),
                {"id": batch_id},
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Delivery not found")
    if (
        row["attempts"] != body.expected_version
        or row["status"] != "failed"
        or row["attempts"] >= 5
    ):
        raise HTTPException(
            409, "Delivery changed or its five-attempt budget is exhausted"
        )
    # No immediate send; worker rechecks assignment, confirmation and authority.
    await db.execute(
        text(
            "update editorial_email_batches set status='pending',available_at=now() where id=:id"
        ),
        {"id": batch_id},
    )
    await audit(
        db,
        user.id,
        row["recipient_id"],
        "notification_retry",
        {"batch_id": str(batch_id), "attempts": row["attempts"]},
    )
    await db.commit()
    return {"status": "pending"}
