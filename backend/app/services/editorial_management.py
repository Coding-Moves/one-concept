"""Versioned account mutations. All authority is rechecked under the account lock."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import CurrentUser
from app.schemas.editorial import AccessInput, InviteInput, Member, ProfileInput
from app.services.editorial_accounts import audit, authorize, check_version, membership
from app.services.editorial_invites import invite_auth_user


async def invite(
    db: AsyncSession, actor: CurrentUser, settings: Settings, body: InviteInput
) -> Member:
    await authorize(db, actor, settings, "manage_reviewers", mutation=True)
    # An existing Auth account is explicitly enrolled by this owner request.
    # Retry after an ambiguous provider response binds the same account instead
    # of sending more mail; confirmation/onboarding are still required.
    rows = (
        (
            await db.execute(
                text("select id from auth.users where lower(email)=:email"),
                {"email": body.email},
            )
        )
        .scalars()
        .all()
    )
    if len(rows) > 1:
        raise HTTPException(
            409, "Resolve duplicate Auth email identities before inviting"
        )
    uid = rows[0] if rows else await invite_auth_user(body.email, settings)
    # Validate provider identity against the authoritative project DB as well.
    matches = await db.scalar(
        text(
            "select exists(select 1 from auth.users where id=:id and lower(email)=:email)"
        ),
        {"id": uid, "email": body.email},
    )
    if not matches:
        raise HTTPException(
            502, "Invited identity is not yet available; retry after checking Auth"
        )
    if await db.scalar(
        text("select exists(select 1 from editorial_memberships where user_id=:id)"),
        {"id": uid},
    ):
        raise HTTPException(
            409, "Reviewer already exists; use their versioned access settings"
        )
    caps = sorted(set(body.capabilities))
    await db.execute(
        text("""insert into editorial_memberships(user_id,invited_email,capabilities)
        values (:id,:email,:caps)"""),
        {"id": uid, "email": body.email, "caps": caps},
    )
    await audit(db, actor.id, uid, "invite", {"capabilities": caps})
    return await membership(db, uid)


async def request_profile(
    db: AsyncSession, actor: CurrentUser, settings: Settings, body: ProfileInput
) -> Member:
    current = await authorize(db, actor, settings, mutation=True)
    check_version(current, body.expected_version)
    if current.requested_name == body.registered_name:
        return current
    await db.execute(
        text("""update editorial_memberships set requested_name=:name,
        version=version+1,updated_at=now() where user_id=:id"""),
        {"name": body.registered_name, "id": actor.id},
    )
    await audit(
        db,
        actor.id,
        actor.id,
        "profile_requested",
        {
            "previous_requested_name": current.requested_name,
            "requested_name": body.registered_name,
            "approved_name": current.approved_name,
            "version": current.version + 1,
        },
    )
    return await membership(db, actor.id)


async def approve_profile(
    db: AsyncSession,
    actor: CurrentUser,
    settings: Settings,
    uid: UUID,
    expected_version: int,
) -> Member:
    await authorize(db, actor, settings, "manage_reviewers", mutation=True)
    if uid == actor.id:
        raise HTTPException(403, "Another administrator must approve your name change")
    current = await membership(db, uid)
    check_version(current, expected_version)
    if current.status != "active" or current.requested_name is None:
        raise HTTPException(409, "An active reviewer must first submit their profile")
    if current.approved_name == current.requested_name:
        return current
    await db.execute(
        text("""update editorial_memberships set approved_name=requested_name,
        version=version+1,updated_at=now() where user_id=:id"""),
        {"id": uid},
    )
    await audit(
        db,
        actor.id,
        uid,
        "profile_approved",
        {
            "previous_approved_name": current.approved_name,
            "approved_name": current.requested_name,
            "version": current.version + 1,
        },
    )
    return await membership(db, uid)


async def change_access(
    db: AsyncSession,
    actor: CurrentUser,
    settings: Settings,
    uid: UUID,
    body: AccessInput,
) -> Member:
    await authorize(db, actor, settings, "manage_reviewers", mutation=True)
    current = await membership(db, uid)
    check_version(current, body.expected_version)
    caps = sorted(set(body.capabilities))
    removing_admin = (
        "manage_reviewers" in current.capabilities
        and current.status == "active"
        and (body.status == "revoked" or "manage_reviewers" not in caps)
    )
    if removing_admin:
        another = await db.scalar(
            text("""select exists(select 1 from editorial_memberships m
            join auth.users u on u.id=m.user_id where m.user_id<>:id and m.status='active'
            and m.approved_name is not null and 'manage_reviewers'=any(m.capabilities)
            and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))"""),
            {"id": uid},
        )
        if not another:
            raise HTTPException(
                409,
                "Keep another confirmed, approved administrator before removing this access",
            )
    if current.status == body.status and set(current.capabilities) == set(caps):
        return current
    await db.execute(
        text("""update editorial_memberships set status=:status,capabilities=:caps,
        version=version+1,updated_at=now() where user_id=:id"""),
        {"id": uid, "status": body.status, "caps": caps},
    )
    await audit(
        db,
        actor.id,
        uid,
        "access_changed",
        {
            "previous_status": current.status,
            "status": body.status,
            "previous_capabilities": current.capabilities,
            "capabilities": caps,
            "version": current.version + 1,
        },
    )
    return await membership(db, uid)
