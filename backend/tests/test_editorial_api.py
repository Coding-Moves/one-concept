import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from app.config import get_settings
from app.db.session import get_db
from app.main import create_app
from app.schemas.editorial import AccessInput
from app.services.editorial_accounts import lock_accounts
from app.services.editorial_management import change_access
from tests import test_editorial_authority
from tests.test_security import _jwks_cache_with, _keypair, _token

editorial = test_editorial_authority.editorial


@pytest_asyncio.fixture
async def api(editorial, sessionmaker_for_test):
    owner, settings = editorial
    app = create_app()
    private, public = _keypair()
    app.state.jwks = _jwks_cache_with(public)

    async def db():
        async with sessionmaker_for_test() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_settings] = lambda: settings

    def headers(uid=owner.id, sid=owner.session_id, aal="aal2", **claims):
        return {
            "Authorization": "Bearer "
            + _token(
                private,
                sub=str(uid),
                session_id=str(sid),
                aal=aal,
                iss=settings.jwt_issuer,
                **claims,
            )
        }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(
            client=client, owner=owner, settings=settings, headers=headers
        )


async def auth_account(session, *, confirmed=True):
    uid, sid = uuid4(), uuid4()
    email = f"{uid}@example.invalid"
    await session.execute(
        text("""insert into auth.users(id,email,email_confirmed_at)
        values (:uid,:email,case when :confirmed then now() else null end)"""),
        {"uid": uid, "email": email, "confirmed": confirmed},
    )
    await session.execute(
        text("insert into auth.sessions(id,user_id) values (:sid,:uid)"),
        {"sid": sid, "uid": uid},
    )
    await session.commit()
    return uid, sid, email


async def enroll(api, session, caps=None):
    uid, sid, email = await auth_account(session)
    result = await api.client.post(
        "/v1/editorial/reviewers",
        headers=api.headers(),
        json={"email": email, "capabilities": caps or ["review"]},
    )
    assert result.status_code == 201, result.text
    return uid, sid, result.json()


async def profile_and_approve(api, uid, sid, version=1, name="Reviewer Name"):
    result = await api.client.patch(
        "/v1/editorial/me/profile",
        headers=api.headers(uid, sid, "aal1"),
        json={"expected_version": version, "registered_name": name},
    )
    assert result.status_code == 200, result.text
    result = await api.client.post(
        f"/v1/editorial/reviewers/{uid}/approve-profile",
        headers=api.headers(),
        json={"expected_version": result.json()["version"]},
    )
    assert result.status_code == 200, result.text
    return result.json()


async def test_multi_reviewer_onboarding_and_editable_profile(api, session):
    # Three initial reviewers plus a fourth: no hard-coded team size.
    for _ in range(4):
        uid, sid, member = await enroll(api, session)
        own = api.headers(uid, sid, "aal1")
        me = await api.client.get("/v1/editorial/me", headers=own)
        assert me.json()["onboarding_required"] and me.json()["mfa_required"]
        assert me.headers["cache-control"] == "no-store"
        member = await profile_and_approve(api, uid, sid)
        assert member["approved_name"] == "Reviewer Name"
        edit = await api.client.patch(
            "/v1/editorial/me/profile",
            headers=own,
            json={
                "expected_version": member["version"],
                "registered_name": "  Updated   Name  ",
            },
        )
        assert edit.status_code == 200
        assert edit.json()["requested_name"] == "Updated Name"
        assert edit.json()["approved_name"] == "Reviewer Name"
        assert (await api.client.get("/v1/editorial/me", headers=own)).json()[
            "name_approval_pending"
        ]
        assert (
            await api.client.get(
                "/v1/editorial/reviewers", headers=api.headers(uid, sid)
            )
        ).status_code == 403
        snapshots = (
            (
                await session.execute(
                    text(
                        "select details from editorial_account_events where subject_id=:uid and action='profile_approved'"
                    ),
                    {"uid": uid},
                )
            )
            .scalars()
            .all()
        )
        assert snapshots == [
            {
                "version": 3,
                "approved_name": "Reviewer Name",
                "previous_approved_name": None,
            }
        ]
    page = await api.client.get(
        "/v1/editorial/reviewers?limit=2", headers=api.headers()
    )
    ids = [m["user_id"] for m in page.json()["items"]]
    while page.json()["next_cursor"]:
        page = await api.client.get(
            "/v1/editorial/reviewers",
            headers=api.headers(),
            params={"limit": 2, "cursor": page.json()["next_cursor"]},
        )
        ids.extend(m["user_id"] for m in page.json()["items"])
    assert len(ids) == len(set(ids)) == 5


async def test_verified_jwt_cannot_invent_editorial_permissions(api, session):
    uid, sid, _ = await auth_account(session)
    headers = api.headers(
        uid, sid, user_metadata={"role": "admin", "capabilities": ["manage_reviewers"]}
    )
    assert (
        await api.client.get("/v1/editorial/me", headers=headers)
    ).status_code == 403
    assert (await api.client.get("/v1/editorial/me")).status_code == 401
    assert (
        await api.client.get("/v1/editorial/me", headers=api.headers(exp=1))
    ).status_code == 401
    assert (
        await api.client.get("/v1/editorial/reviewers", headers=api.headers(aal="aal1"))
    ).status_code == 403
    uid, sid, member = await enroll(api, session)
    # Extra identity/role fields cannot be smuggled through profile requests.
    for extra in (
        {"capabilities": ["manage_reviewers"]},
        {"approved_name": "Forged"},
        {"user_id": str(api.owner.id)},
    ):
        response = await api.client.patch(
            "/v1/editorial/me/profile",
            headers=api.headers(uid, sid),
            json={"expected_version": 1, "registered_name": "Name", **extra},
        )
        assert response.status_code == 422


async def test_stale_name_approval_and_duplicate_enrollment(api, session):
    uid, sid, member = await enroll(api, session)
    duplicate = await api.client.post(
        "/v1/editorial/reviewers",
        headers=api.headers(),
        json={"email": member["invited_email"], "capabilities": ["manage_reviewers"]},
    )
    assert duplicate.status_code == 409
    own = api.headers(uid, sid)
    first = await api.client.patch(
        "/v1/editorial/me/profile",
        headers=own,
        json={"expected_version": 1, "registered_name": "First Name"},
    )
    await api.client.patch(
        "/v1/editorial/me/profile",
        headers=own,
        json={
            "expected_version": first.json()["version"],
            "registered_name": "Second Name",
        },
    )
    stale = await api.client.post(
        f"/v1/editorial/reviewers/{uid}/approve-profile",
        headers=api.headers(),
        json={"expected_version": first.json()["version"]},
    )
    assert stale.status_code == 409
    assert (
        await session.scalar(
            text("select approved_name from editorial_memberships where user_id=:uid"),
            {"uid": uid},
        )
        is None
    )
    self_approval = await api.client.post(
        f"/v1/editorial/reviewers/{api.owner.id}/approve-profile",
        headers=api.headers(),
        json={"expected_version": 1},
    )
    assert self_approval.status_code == 403


async def test_revocation_and_last_administrator_protection(api, session):
    owner_id = api.owner.id
    blocked = await api.client.patch(
        f"/v1/editorial/reviewers/{owner_id}/access",
        headers=api.headers(),
        json={"expected_version": 1, "status": "revoked", "capabilities": []},
    )
    assert blocked.status_code == 409
    uid, sid, _ = await enroll(api, session, ["manage_reviewers"])
    # An admin lacking an approved identity cannot substitute for the last owner.
    blocked = await api.client.patch(
        f"/v1/editorial/reviewers/{owner_id}/access",
        headers=api.headers(),
        json={"expected_version": 1, "status": "revoked", "capabilities": []},
    )
    assert blocked.status_code == 409
    await profile_and_approve(api, uid, sid)
    revoked = await api.client.patch(
        f"/v1/editorial/reviewers/{owner_id}/access",
        headers=api.headers(uid, sid),
        json={"expected_version": 1, "status": "revoked", "capabilities": []},
    )
    assert revoked.status_code == 200
    assert (
        await api.client.get("/v1/editorial/me", headers=api.headers())
    ).status_code == 403
    assert (
        await api.client.get("/v1/editorial/reviewers", headers=api.headers())
    ).status_code == 403
    # A removed Auth session also invalidates an otherwise valid signed token.
    await session.execute(text("delete from auth.sessions where id=:sid"), {"sid": sid})
    await session.commit()
    assert (
        await api.client.get("/v1/editorial/me", headers=api.headers(uid, sid))
    ).status_code == 401


async def test_queued_mutation_rechecks_revocation(api, session, sessionmaker_for_test):
    uid, sid, member = await enroll(api, session)
    async with sessionmaker_for_test() as blocker:
        await lock_accounts(blocker)
        pending = asyncio.create_task(
            api.client.patch(
                "/v1/editorial/me/profile",
                headers=api.headers(uid, sid),
                json={"expected_version": 1, "registered_name": "Too Late"},
            )
        )
        try:
            # Observe the request blocked on the actual PostgreSQL lock.
            for _ in range(100):
                waiting = await session.scalar(
                    text(
                        "select count(*) from pg_locks where locktype='advisory' and not granted and classid=274"
                    )
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            assert waiting
            await change_access(
                blocker,
                api.owner,
                api.settings,
                uid,
                AccessInput(expected_version=1, status="revoked", capabilities=[]),
            )
            await blocker.commit()
            response = await asyncio.wait_for(pending, 5)
            assert response.status_code == 403
        finally:
            await blocker.rollback()
            if not pending.done():
                pending.cancel()
    assert (
        await session.scalar(
            text("select requested_name from editorial_memberships where user_id=:uid"),
            {"uid": uid},
        )
        is None
    )


async def test_queued_mutation_rejects_session_that_expires_during_wait(
    api, session, sessionmaker_for_test
):
    uid, sid, _ = await enroll(api, session)
    await session.execute(
        text("""update auth.sessions
        set not_after=clock_timestamp()+interval '3 seconds' where id=:sid"""),
        {"sid": sid},
    )
    await session.commit()
    async with sessionmaker_for_test() as blocker:
        await lock_accounts(blocker)
        pending = asyncio.create_task(
            api.client.patch(
                "/v1/editorial/me/profile",
                headers=api.headers(uid, sid),
                json={"expected_version": 1, "registered_name": "Expired Session"},
            )
        )
        try:
            for _ in range(100):
                waiting = await session.scalar(
                    text("""select count(*) from pg_locks where locktype='advisory'
                    and not granted and classid=274 and objid=263""")
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            assert waiting, "Request must reach the lock before its session expires"
            # The deadline exists before the request; let it expire naturally.
            # now() would still refer to the transaction started before the wait.
            await asyncio.sleep(3.1)
            await blocker.commit()
            response = await asyncio.wait_for(pending, 5)
            assert response.status_code == 401, response.text
        finally:
            await blocker.rollback()
            if not pending.done():
                pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
    member = (
        await session.execute(
            text("""select requested_name,version from editorial_memberships
            where user_id=:uid"""),
            {"uid": uid},
        )
    ).one()
    assert member == (None, 1)
    assert not await session.scalar(
        text("""select exists(select 1 from editorial_account_events
        where subject_id=:uid and action='profile_requested')"""),
        {"uid": uid},
    )


@pytest.mark.parametrize(
    "denial,status",
    [
        ("nonmember", 403),
        ("revoked", 403),
        ("missing_capability", 403),
        ("missing_name", 403),
        ("aal1", 403),
        ("expired_session", 401),
        ("deleted_session", 401),
        ("unconfirmed", 401),
        ("banned", 401),
    ],
)
async def test_unauthorized_mutations_do_not_wait_for_account_lock(
    api, session, sessionmaker_for_test, denial, status
):
    headers = api.headers()
    if denial == "nonmember":
        uid, sid, _ = await auth_account(session)
        headers = api.headers(uid, sid)
    elif denial == "aal1":
        headers = api.headers(aal="aal1")
    else:
        queries = {
            "revoked": "update editorial_memberships set status='revoked'",
            "missing_capability": "update editorial_memberships set capabilities='{}'",
            "missing_name": "update editorial_memberships set approved_name=null",
            "expired_session": "update auth.sessions set not_after=now()-interval '1 second' where user_id=:uid",
            "deleted_session": "delete from auth.sessions where user_id=:uid",
            "unconfirmed": "update auth.users set email_confirmed_at=null where id=:uid",
            "banned": "update auth.users set banned_until=now()+interval '1 day' where id=:uid",
        }
        await session.execute(text(queries[denial]), {"uid": api.owner.id})
        await session.commit()
    async with sessionmaker_for_test() as blocker:
        await lock_accounts(blocker)
        # The lock remains held until AFTER the response. Any attempt to wait
        # on it would time out instead of promptly denying the request.
        try:
            response = await asyncio.wait_for(
                api.client.post(
                    "/v1/editorial/reviewers",
                    headers=headers,
                    json={"email": "not-invited@example.invalid"},
                ),
                timeout=2,
            )
            assert response.status_code == status, response.text
        finally:
            await blocker.rollback()
    assert not await session.scalar(
        text("select exists(select 1 from editorial_account_events where action='invite')")
    )


async def test_queued_mutation_rechecks_capability(api, session, sessionmaker_for_test):
    uid, sid, _ = await enroll(api, session, ["manage_reviewers"])
    member = await profile_and_approve(api, uid, sid)
    # Use an existing Auth account so a broken guard cannot send live email.
    other_uid, _, email = await auth_account(session)
    async with sessionmaker_for_test() as blocker:
        await lock_accounts(blocker)
        pending = asyncio.create_task(
            api.client.post(
                "/v1/editorial/reviewers",
                headers=api.headers(uid, sid),
                json={"email": email},
            )
        )
        try:
            for _ in range(100):
                waiting = await session.scalar(
                    text("""select count(*) from pg_locks where locktype='advisory'
                    and not granted and classid=274 and objid=263""")
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            assert waiting
            await change_access(
                blocker,
                api.owner,
                api.settings,
                uid,
                AccessInput(
                    expected_version=member["version"],
                    status="active",
                    capabilities=["review"],
                ),
            )
            await blocker.commit()
            response = await asyncio.wait_for(pending, 5)
            assert response.status_code == 403, response.text
        finally:
            await blocker.rollback()
            if not pending.done():
                pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
    assert not await session.scalar(
        text("select exists(select 1 from editorial_memberships where user_id=:uid)"),
        {"uid": other_uid},
    )
    assert not await session.scalar(
        text("select exists(select 1 from editorial_account_events where subject_id=:uid)"),
        {"uid": other_uid},
    )


async def test_invitation_failure_has_no_membership_and_retry_is_safe(
    api, session, monkeypatch
):
    import app.services.editorial_management as service

    uid, sid = uuid4(), uuid4()
    email = f"{uid}@example.invalid"
    calls = 0

    async def provider(address, settings):
        nonlocal calls
        calls += 1
        await session.execute(
            text("insert into auth.users(id,email) values (:id,:email)"),
            {"id": uid, "email": email},
        )
        await session.execute(
            text("insert into auth.sessions(id,user_id) values (:sid,:uid)"),
            {"sid": sid, "uid": uid},
        )
        await session.commit()
        from fastapi import HTTPException

        raise HTTPException(502, "Ambiguous provider response")

    monkeypatch.setattr(service, "invite_auth_user", provider)
    failed = await api.client.post(
        "/v1/editorial/reviewers", headers=api.headers(), json={"email": email}
    )
    assert failed.status_code == 502
    assert not await session.scalar(
        text("select exists(select 1 from editorial_memberships where user_id=:uid)"),
        {"uid": uid},
    )
    retried = await api.client.post(
        "/v1/editorial/reviewers", headers=api.headers(), json={"email": email}
    )
    assert retried.status_code == 201 and calls == 1
    # Invitation is not equivalent to confirmation or approved onboarding.
    assert (
        await api.client.get("/v1/editorial/me", headers=api.headers(uid, sid))
    ).status_code == 401


async def test_concurrent_enrollment_creates_one_membership(api, session):
    uid, _, email = await auth_account(session)
    responses = await asyncio.gather(
        *[
            api.client.post(
                "/v1/editorial/reviewers", headers=api.headers(), json={"email": email}
            )
            for _ in range(2)
        ]
    )
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_account_events where subject_id=:uid and action='invite'"
            ),
            {"uid": uid},
        )
        == 1
    )


async def test_errors_are_private_and_do_not_echo_extra_credentials(api):
    denied = await api.client.get("/v1/editorial/me")
    assert denied.status_code == 401
    assert denied.headers["cache-control"] == "no-store"
    bad = await api.client.post(
        "/v1/editorial/reviewers",
        headers=api.headers(),
        json={"email": "test@example.invalid", "password": "accidental-secret"},
    )
    assert bad.status_code == 422
    assert bad.headers["cache-control"] == "no-store"
    assert "accidental-secret" not in bad.text
