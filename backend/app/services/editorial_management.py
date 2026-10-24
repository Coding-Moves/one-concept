"""Versioned account mutations. All authority is rechecked under the account lock."""

import json
import time
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import CurrentUser
from app.schemas.editorial import (
    AccessInput, AuthenticatorInput, InviteInput, Member, ProfileInput,
    ReviewerRemoval,
)
from app.services.editorial_accounts import audit, authorize, check_version, membership
from app.services.editorial_invites import invite_auth_user

MAX_ACTIVE_REVIEWERS = 10


async def require_team_slot(db: AsyncSession) -> None:
    # Account mutations hold the same advisory lock, so concurrent invitations
    # and reactivations cannot both claim the last slot.
    active = await db.scalar(
        text("select count(*) from public.editorial_memberships where status='active'")
    )
    if active >= MAX_ACTIVE_REVIEWERS:
        raise HTTPException(409, "The team already has 10 active reviewers")


async def invite(
    db: AsyncSession, actor: CurrentUser, settings: Settings, body: InviteInput
) -> Member:
    await authorize(db, actor, settings, "manage_reviewers", mutation=True)
    await require_team_slot(db)
    # Confirmed learners keep their account and password. An unconfirmed Auth
    # identity may be an earlier invite whose membership transaction failed;
    # resend its invitation so it still has a usable confirmation/setup link.
    rows = (
        (
            await db.execute(
                text("select id,email_confirmed_at from auth.users where lower(email)=:email"),
                {"email": body.email},
            )
        )
        .mappings()
        .all()
    )
    if len(rows) > 1:
        raise HTTPException(
            409, "Resolve duplicate Auth email identities before inviting"
        )
    uid = (
        rows[0]["id"]
        if rows and rows[0]["email_confirmed_at"] is not None
        else await invite_auth_user(body.email, settings)
    )
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
        text("""insert into editorial_memberships(user_id,invited_email,capabilities,require_mfa)
        values (:id,:email,:caps,false)"""),
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


async def set_authenticator_requirement(
    db: AsyncSession, actor: CurrentUser, settings: Settings, body: AuthenticatorInput
) -> Member:
    current = await authorize(db, actor, settings, mutation=True)
    check_version(current, body.expected_version)
    if current.require_mfa == body.require_mfa:
        return current
    if not body.require_mfa:
        verified_at = actor.mfa_verified_at
        now = time.time()
        if (
            actor.aal != "aal2"
            or verified_at is None
            or not now - 300 <= verified_at <= now + 60
        ):
            raise HTTPException(403, "Verify a current authenticator code before turning it off")
    await db.execute(
        text("""update editorial_memberships set require_mfa=:required,
        version=version+1,updated_at=now() where user_id=:id"""),
        {"required": body.require_mfa, "id": actor.id},
    )
    await audit(db, actor.id, actor.id, "authenticator_choice", {
        "previous_required": current.require_mfa,
        "required": body.require_mfa,
        "version": current.version + 1,
    })
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
    if current.status != "active" and body.status == "active":
        await require_team_slot(db)
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


async def remove_reviewer(
    db: AsyncSession,
    actor: CurrentUser,
    settings: Settings,
    uid: UUID,
    expected_version: int,
) -> ReviewerRemoval:
    await authorize(db, actor, settings, "manage_reviewers")
    payload = await db.scalar(
        text("""select public.edge_api_editorial_reviewer_remove(
          cast(:actor as uuid),cast(:session as uuid),:aal,
          cast(:subject as uuid),:version)"""),
        {"actor": actor.id, "session": actor.session_id, "aal": actor.aal,
         "subject": uid, "version": expected_version},
    )
    if isinstance(payload, str):
        payload = json.loads(payload)
    errors = {
        "invalid": (422, "Invalid reviewer removal"),
        "session_required": (401, "A confirmed account and current session are required"),
        "unavailable": (403, "Editorial access is unavailable"),
        "permission": (403, "Editorial permission required"),
        "profile_required": (403, "Complete profile setup and obtain name approval"),
        "mfa_required": (403, "Complete MFA verification for editorial actions"),
        "self_removal": (403, "You cannot remove your own reviewer access"),
        "reviewer_not_found": (404, "Reviewer not found"),
        "version_conflict": (409, "Account changed; reload before removing"),
        "last_admin": (409, "Keep another confirmed, approved administrator before removing this access"),
    }
    if isinstance(payload, dict) and payload.get("error") in errors:
        status, detail = errors[payload["error"]]
        raise HTTPException(status, detail)
    if not isinstance(payload, dict) or "removed_user_id" not in payload:
        raise HTTPException(503, "Reviewer removal is unavailable")
    return ReviewerRemoval.model_validate(payload)
