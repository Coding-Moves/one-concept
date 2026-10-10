import time

from sqlalchemy import text

from tests.test_editorial_api import enroll, profile_and_approve

pytest_plugins = ["tests.test_editorial_api"]


async def test_owner_must_prove_recent_totp_to_turn_off_authenticator(api, session):
    current = (await api.client.get("/v1/editorial/me", headers=api.headers())).json()
    assert current["member"]["require_mfa"] is True
    assert current["mfa_required"] is False
    version = current["member"]["version"]
    body = {"expected_version": version, "require_mfa": False}
    for headers in (
        api.headers(aal="aal1"),
        api.headers(),
        api.headers(amr=[{"method": "totp", "timestamp": int(time.time()) - 301}]),
        api.headers(amr=[{"method": "password", "timestamp": int(time.time())}]),
    ):
        denied = await api.client.patch("/v1/editorial/me/authenticator", headers=headers, json=body)
        assert denied.status_code == 403
    assert (await api.client.get("/v1/editorial/reviewers", headers=api.headers(aal="aal1"))).status_code == 403
    fresh = api.headers(amr=[{"method": "totp", "timestamp": int(time.time())}])
    changed = await api.client.patch("/v1/editorial/me/authenticator", headers=fresh, json=body)
    assert changed.status_code == 200, changed.text
    assert changed.json()["require_mfa"] is False
    assert changed.json()["version"] == version + 1
    assert (await api.client.get("/v1/editorial/reviewers", headers=api.headers(aal="aal1"))).status_code == 200
    assert (await api.client.get("/v1/editorial/me", headers=api.headers(aal="aal1"))).json()["mfa_required"] is False
    assert await session.scalar(text("select count(*) from editorial_account_events where action='authenticator_choice' and actor_id=:id and subject_id=:id"), {"id": api.owner.id}) == 1


async def test_reenable_authenticator_restores_gate_and_versions(api):
    first = (await api.client.get("/v1/editorial/me", headers=api.headers())).json()["member"]
    fresh = api.headers(amr=[{"method": "totp", "timestamp": int(time.time())}])
    turned_off = await api.client.patch("/v1/editorial/me/authenticator", headers=fresh,
        json={"expected_version": first["version"], "require_mfa": False})
    assert turned_off.status_code == 200
    version = turned_off.json()["version"]
    stale = await api.client.patch("/v1/editorial/me/authenticator", headers=api.headers(aal="aal1"),
        json={"expected_version": first["version"], "require_mfa": True})
    assert stale.status_code == 409
    enabled = await api.client.patch("/v1/editorial/me/authenticator", headers=api.headers(aal="aal1"),
        json={"expected_version": version, "require_mfa": True})
    assert enabled.status_code == 200
    assert enabled.json()["require_mfa"] is True
    assert (await api.client.get("/v1/editorial/reviewers", headers=api.headers(aal="aal1"))).status_code == 403
    assert (await api.client.get("/v1/editorial/me", headers=api.headers(aal="aal1"))).json()["mfa_required"] is True


async def test_reviewer_can_change_only_their_own_authenticator_choice(api, session):
    uid, sid, _ = await enroll(api, session)
    reviewer = await profile_and_approve(api, uid, sid)
    initial = (await api.client.get("/v1/editorial/me", headers=api.headers(uid, sid, "aal1"))).json()
    assert initial["member"]["require_mfa"] is True
    reviewer_fresh = api.headers(uid, sid, "aal2", amr=[{"method": "totp", "timestamp": int(time.time())}])
    changed = await api.client.patch("/v1/editorial/me/authenticator", headers=reviewer_fresh,
        json={"expected_version": reviewer["version"], "require_mfa": False})
    assert changed.status_code == 200, changed.text
    assert changed.json()["user_id"] == str(uid)
    assert (await api.client.get("/v1/editorial/queue", headers=api.headers(uid, sid, "aal1"))).status_code == 200
    owner = (await api.client.get("/v1/editorial/me", headers=api.headers())).json()["member"]
    assert owner["require_mfa"] is True


async def test_revoked_or_spoofed_authenticator_change_is_rejected(api, session):
    uid, sid, member = await enroll(api, session)
    fresh = api.headers(uid, sid, "aal2", amr=[{"method": "totp", "timestamp": int(time.time())}])
    spoofed = await api.client.patch("/v1/editorial/me/authenticator", headers=fresh,
        json={"expected_version": member["version"], "require_mfa": False, "user_id": str(api.owner.id)})
    assert spoofed.status_code == 422
    await session.execute(text("update editorial_memberships set status='revoked' where user_id=:uid"), {"uid": uid})
    await session.commit()
    revoked = await api.client.patch("/v1/editorial/me/authenticator", headers=fresh,
        json={"expected_version": member["version"], "require_mfa": False})
    assert revoked.status_code == 403
    assert (await api.client.get("/v1/editorial/me", headers=api.headers())).json()["member"]["require_mfa"] is True
