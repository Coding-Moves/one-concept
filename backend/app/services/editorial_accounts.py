"""Backend-only editorial authority, independent of editable Auth metadata.

Account mutations share one transaction advisory lock. Authorize before waiting
so denied requests do not queue, then recheck AFTER taking it so a queued write
cannot outrun a revocation or role change.
Callers own commit/rollback; the lock lasts until the transaction ends.
"""

import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import CurrentUser
from app.schemas.editorial import (
    CAPABILITIES,
    Capability,
    Member,
    validate_registered_name,
)


async def lock_accounts(db: AsyncSession) -> None:
    await db.execute(text("select pg_advisory_xact_lock(274, 263)"))


async def membership(db: AsyncSession, user_id: UUID) -> Member:
    row = (
        (
            await db.execute(
                text("select * from public.editorial_memberships where user_id=:id"),
                {"id": user_id},
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(403, "Editorial access is unavailable")
    return Member.model_validate(dict(row))


async def authorize(
    db: AsyncSession,
    user: CurrentUser,
    settings: Settings,
    capability: Capability | None = None,
    *,
    mutation: bool = False,
) -> Member:
    if not settings.editorial_enabled:
        raise HTTPException(503, "Editorial access is disabled")
    member = await _authorize_current(db, user, capability)
    if mutation:
        await lock_accounts(db)
        # READ COMMITTED reads fresh authority after any lock wait. Never reuse
        # the preliminary membership: another transaction may have revoked it.
        member = await _authorize_current(db, user, capability)
    return member


async def _authorize_current(
    db: AsyncSession, user: CurrentUser, capability: Capability | None
) -> Member:
    try:
        session_id = UUID(user.session_id or "")
    except ValueError:
        raise HTTPException(401, "A current Supabase session is required") from None
    # Authoritative confirmation and current session ownership, not JWT email,
    # role, app_metadata or user_metadata. Expiry/signature are checked by deps.
    # statement_timestamp() includes elapsed lock waits; now() would not.
    valid = await db.scalar(
        text("""
        select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
          where u.id=:uid and s.id=:sid and u.email_confirmed_at is not null
            and (u.banned_until is null or u.banned_until <= statement_timestamp())
            and (s.not_after is null or s.not_after > statement_timestamp()))
    """),
        {"uid": user.id, "sid": session_id},
    )
    if not valid:
        raise HTTPException(401, "A confirmed account and current session are required")
    member = await membership(db, user.id)
    if member.status != "active":
        raise HTTPException(403, "Editorial access is unavailable")
    if capability is not None:
        if capability not in member.capabilities:
            raise HTTPException(403, "Editorial permission required")
        if member.approved_name is None:
            raise HTTPException(403, "Complete profile setup and obtain name approval")
        if user.aal != "aal2":
            raise HTTPException(403, "Complete MFA verification for editorial actions")
    return member


async def audit(
    db: AsyncSession, actor: UUID, subject: UUID, action: str, details: dict
) -> None:
    await db.execute(
        text("""insert into public.editorial_account_events
        (actor_id,subject_id,action,details) values (:actor,:subject,:action,cast(:details as jsonb))"""),
        {
            "actor": actor,
            "subject": subject,
            "action": action,
            "details": json.dumps(details),
        },
    )


def check_version(member: Member, expected: int) -> None:
    if member.version != expected:
        raise HTTPException(409, "Account changed; reload before saving")


async def bootstrap_owner(db: AsyncSession, email: str, name: str) -> Member:
    """Trusted operator CLI only. There is intentionally no HTTP bootstrap route."""
    name = validate_registered_name(name)
    await lock_accounts(db)
    if await db.scalar(
        text("""select exists(select 1 from public.editorial_memberships)
            or exists(select 1 from public.editorial_account_events where action='bootstrap')""")
    ):
        raise HTTPException(
            409, "Bootstrap is only available before the first editorial account"
        )
    rows = (
        (
            await db.execute(
                text("""select id,email from auth.users
        where lower(email)=:email and email_confirmed_at is not null
          and (banned_until is null or banned_until <= now())"""),
                {"email": email.strip().lower()},
            )
        )
        .mappings()
        .all()
    )
    if len(rows) != 1:
        raise HTTPException(
            409, "Bootstrap requires one existing confirmed Supabase account"
        )
    row = rows[0]
    await db.execute(
        text("""insert into public.editorial_memberships
        (user_id,invited_email,capabilities,requested_name,approved_name)
        values (:uid,:email,:caps,:name,:name)"""),
        {"uid": row["id"], "email": row["email"], "caps": CAPABILITIES, "name": name},
    )
    await audit(
        db,
        row["id"],
        row["id"],
        "bootstrap",
        {"approved_name": name, "capabilities": CAPABILITIES},
    )
    return await membership(db, row["id"])
