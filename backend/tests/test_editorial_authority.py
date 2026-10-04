from dataclasses import replace
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import text

from app.config import Settings
from app.deps import CurrentUser
from app.schemas.editorial import CAPABILITIES
from app.services.editorial_accounts import authorize, bootstrap_owner


@pytest_asyncio.fixture
async def editorial(session, user):
    await session.execute(
        text("truncate public.editorial_legacy_batch_entries, public.editorial_legacy_batches, public.editorial_memberships, public.editorial_account_events")
    )
    await session.execute(
        text("update auth.users set email_confirmed_at=now() where id=:id"),
        {"id": user},
    )
    sid = uuid4()
    await session.execute(
        text("insert into auth.sessions(id,user_id) values (:sid,:uid)"),
        {"sid": sid, "uid": user},
    )
    await bootstrap_owner(session, f"{user}@example.invalid", "Initial Owner")
    await session.commit()
    settings = Settings(
        _env_file=None,
        database_url="postgresql://unused",
        supabase_url="https://test.invalid",
        supabase_jwks_url="https://test.invalid/jwks",
        editorial_enabled=True,
    )
    return CurrentUser(
        user, "untrusted-email@example.invalid", str(sid), "aal2"
    ), settings


async def test_owner_permissions_and_bootstrap_is_one_time(session, editorial):
    user, settings = editorial
    for cap in CAPABILITIES:
        assert (
            await authorize(session, user, settings, cap)
        ).approved_name == "Initial Owner"
    with pytest.raises(HTTPException) as exc:
        await bootstrap_owner(session, user.email, "Other Owner")
    assert exc.value.status_code == 409


@pytest.mark.parametrize(
    "change,status",
    [
        ("revoked", 403),
        ("no_membership", 403),
        ("unconfirmed", 401),
        ("banned", 401),
        ("logged_out", 401),
        ("expired_session", 401),
        ("wrong_session_owner", 401),
        ("missing_name", 403),
        ("missing_capability", 403),
    ],
)
async def test_editorial_authority_fails_closed(session, editorial, change, status):
    user, settings = editorial
    queries = {
        "revoked": "update editorial_memberships set status='revoked'",
        "no_membership": "delete from editorial_memberships",
        "unconfirmed": "update auth.users set email_confirmed_at=null where id=:uid",
        "banned": "update auth.users set banned_until=now()+interval '1 day' where id=:uid",
        "logged_out": "delete from auth.sessions where user_id=:uid",
        "expired_session": "update auth.sessions set not_after=now()-interval '1 second' where user_id=:uid",
        "wrong_session_owner": "delete from auth.sessions where user_id=:uid",
        "missing_name": "update editorial_memberships set approved_name=null",
        "missing_capability": "update editorial_memberships set capabilities='{}'",
    }
    await session.execute(text(queries[change]), {"uid": user.id})
    if change == "wrong_session_owner":
        other = uuid4()
        await session.execute(
            text(
                "insert into auth.users(id,email) values (:id,'other@example.invalid')"
            ),
            {"id": other},
        )
        await session.execute(
            text("insert into auth.sessions(id,user_id) values (:id,:uid)"),
            {"id": user.session_id, "uid": other},
        )
    with pytest.raises(HTTPException) as exc:
        await authorize(session, user, settings, "manage_reviewers")
    assert exc.value.status_code == status


async def test_onboarding_allows_aal1_but_actions_require_mfa(session, editorial):
    user, settings = editorial
    weak = replace(user, aal="aal1")
    assert await authorize(session, weak, settings)
    with pytest.raises(HTTPException, match="MFA"):
        await authorize(session, weak, settings, "review")
    with pytest.raises(HTTPException) as exc:
        await authorize(session, replace(user, session_id=None), settings)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        await authorize(
            session, user, settings.model_copy(update={"editorial_enabled": False})
        )
    assert exc.value.status_code == 503


async def test_membership_and_audit_are_not_client_accessible(session, editorial):
    await session.execute(text("set local role authenticated"))
    for table in (
        "editorial_legacy_batches",
        "editorial_legacy_batch_entries",
        "editorial_memberships",
        "editorial_account_events",
    ):
        assert not await session.scalar(
            text("select has_table_privilege(current_user,:table,'SELECT')"),
            {"table": table},
        )
        assert not await session.scalar(
            text("select has_table_privilege(current_user,:table,'INSERT')"),
            {"table": table},
        )
    await session.rollback()


async def test_bootstrap_requires_confirmed_account(session, user):
    await session.execute(
        text("truncate editorial_legacy_batch_entries, editorial_legacy_batches, editorial_memberships, editorial_account_events")
    )
    with pytest.raises(HTTPException) as exc:
        await bootstrap_owner(session, f"{user}@example.invalid", "Unconfirmed")
    assert exc.value.status_code == 409


async def test_bootstrap_cannot_replace_deleted_team(session, editorial):
    user, _ = editorial
    await session.execute(text("delete from editorial_memberships"))
    with pytest.raises(HTTPException) as exc:
        await bootstrap_owner(session, f"{user.id}@example.invalid", "Replacement")
    assert exc.value.status_code == 409


@pytest.mark.parametrize("cap", CAPABILITIES)
async def test_each_capability_is_independent(session, editorial, cap):
    user, settings = editorial
    await session.execute(
        text("update editorial_memberships set capabilities=:caps"), {"caps": [cap]}
    )
    assert await authorize(session, user, settings, cap)
    for other in set(CAPABILITIES) - {cap}:
        with pytest.raises(HTTPException) as exc:
            await authorize(session, user, settings, other)
        assert exc.value.status_code == 403
