"""Editorial identity checks current Auth session and server-side membership."""

import json
import uuid

import pytest
from sqlalchemy import text


ME = text("select public.edge_api_editorial_me(:uid,:sid,:aal)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_me_requires_current_confirmed_session_and_membership(session, user):
    sid = uuid.uuid4()
    args = {"uid": user, "sid": sid, "aal": "aal1"}
    assert _json(await session.scalar(ME, args))["error"] == "session_required"
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"), args)
    assert _json(await session.scalar(ME, args))["error"] == "session_required"
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), args)
    assert _json(await session.scalar(ME, args))["error"] == "unavailable"
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities) values(:uid,'owner@example.invalid',array['review'])"""), args)
    onboarding = _json(await session.scalar(ME, args))
    assert onboarding["onboarding_required"] is True
    assert onboarding["name_approval_pending"] is False
    assert onboarding["mfa_required"] is True
    assert onboarding["member"]["user_id"] == str(user)
    await session.execute(text("""update public.editorial_memberships
      set requested_name='Owner Name' where user_id=:uid"""), args)
    pending = _json(await session.scalar(ME, args))
    assert pending["name_approval_pending"] is True
    args["aal"] = "aal2"
    assert _json(await session.scalar(ME, args))["mfa_required"] is False
    await session.execute(text("update auth.sessions set not_after=now()-interval '1 second' where id=:sid"), args)
    assert _json(await session.scalar(ME, args))["error"] == "session_required"
    await session.execute(text("update auth.sessions set not_after=null where id=:sid"), args)
    await session.execute(text("update auth.users set banned_until=now()+interval '1 day' where id=:uid"), args)
    assert _json(await session.scalar(ME, args))["error"] == "session_required"
    await session.execute(text("update auth.users set banned_until=null where id=:uid"), args)
    other = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values(:id,'other@example.invalid')"),
                          {"id": other})
    await session.execute(text("update auth.sessions set user_id=:other where id=:sid"),
                          {"other": other, "sid": sid})
    assert _json(await session.scalar(ME, args))["error"] == "session_required"
    await session.execute(text("update auth.sessions set user_id=:uid where id=:sid"), args)
    await session.execute(text("update public.editorial_memberships set status='revoked' where user_id=:uid"), args)
    assert _json(await session.scalar(ME, args))["error"] == "unavailable"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated', 'public.edge_api_editorial_me(uuid,uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.edge_api_editorial_me(uuid,uuid,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_editorial_reviewer_pages_require_capability_name_and_mfa(session, user):
    sid = uuid.uuid4()
    peer = uuid.uuid4()
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), {"uid": user})
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"),
                          {"sid": sid, "uid": user})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,'owner@example.invalid',array['manage_reviewers'],'Owner Name','Owner Name')"""),
      {"uid": user})
    await session.execute(text("insert into auth.users(id,email) values(:id,'reviewer@example.invalid')"),
                          {"id": peer})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities) values(:uid,'reviewer@example.invalid',array['review'])"""),
      {"uid": peer})
    page = text("select public.edge_api_editorial_reviewers(:uid,:sid,:aal,:cursor,:limit)")
    args = {"uid": user, "sid": sid, "aal": "aal1", "cursor": None, "limit": 1}
    assert _json(await session.scalar(page, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    first = _json(await session.scalar(page, args))
    assert len(first["items"]) == 1 and first["next_cursor"]
    seen = {first["items"][0]["user_id"]}
    cursor = first["next_cursor"]
    while cursor:
        args["cursor"] = uuid.UUID(cursor)
        following = _json(await session.scalar(page, args))
        assert len(following["items"]) == 1
        seen.add(following["items"][0]["user_id"])
        assert following["next_cursor"] != cursor
        cursor = following["next_cursor"]
    assert {str(user), str(peer)} <= seen
    args["cursor"] = None
    await session.execute(text("update public.editorial_memberships set capabilities='{}' where user_id=:uid"),
                          {"uid": user})
    assert _json(await session.scalar(page, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['manage_reviewers'], approved_name=null where user_id=:uid"""),
      {"uid": user})
    assert _json(await session.scalar(page, args))["error"] == "profile_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_reviewers(uuid,uuid,text,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_reviewers(uuid,uuid,text,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_editorial_profile_request_rechecks_session_and_version_under_lock(session, user):
    sid = uuid.uuid4()
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), {"uid": user})
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"),
                          {"sid": sid, "uid": user})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities) values(:uid,'reviewer@example.invalid',array['review'])"""),
      {"uid": user})
    request = text("""select public.edge_api_editorial_request_profile(
      :uid,:sid,:aal,:version,:name)""")
    args = {"uid": user, "sid": sid, "aal": "aal1", "version": 1, "name": "Reviewer Name"}
    first = _json(await session.scalar(request, args))
    assert first["requested_name"] == "Reviewer Name" and first["version"] == 2
    assert _json(await session.scalar(request, args))["error"] == "version_conflict"
    args["version"] = 2
    assert _json(await session.scalar(request, args))["version"] == 2
    assert await session.scalar(text("""select count(*) from public.editorial_account_events
      where actor_id=:uid and action='profile_requested'"""), {"uid": user}) == 1
    await session.execute(text("delete from auth.sessions where id=:sid"), {"sid": sid})
    assert _json(await session.scalar(request, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_request_profile(uuid,uuid,text,integer,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_request_profile(uuid,uuid,text,integer,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_editorial_notification_timezone_is_versioned_and_session_bound(session, user):
    sid = uuid.uuid4()
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), {"uid": user})
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"),
                          {"sid": sid, "uid": user})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities) values(:uid,'reviewer@example.invalid',array['review'])"""),
      {"uid": user})
    change = text("""select public.edge_api_editorial_notification_timezone(
      :uid,:sid,:aal,:version,:timezone)""")
    args = {"uid": user, "sid": sid, "aal": "aal1", "version": 1,
            "timezone": "Asia/Karachi"}
    assert _json(await session.scalar(change, args))["notification_timezone"] == "Asia/Karachi"
    assert _json(await session.scalar(change, args))["error"] == "version_conflict"
    args["version"] = 2
    args["timezone"] = "Not/A_Timezone"
    assert _json(await session.scalar(change, args))["error"] == "unknown_timezone"
    assert await session.scalar(text("""select count(*) from public.editorial_account_events
      where actor_id=:uid and action='notification_timezone'"""), {"uid": user}) == 1
    await session.execute(text("delete from auth.sessions where id=:sid"), {"sid": sid})
    args["timezone"] = "UTC"
    assert _json(await session.scalar(change, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_notification_timezone(uuid,uuid,text,integer,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_notification_timezone(uuid,uuid,text,integer,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_editorial_authenticator_choice_requires_recent_totp_to_disable(session, user):
    sid = uuid.uuid4()
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), {"uid": user})
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"),
                          {"sid": sid, "uid": user})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities) values(:uid,'reviewer@example.invalid',array['review'])"""),
      {"uid": user})
    change = text("""select public.edge_api_editorial_authenticator(
      :uid,:sid,:aal,:verified_at,:version,:required)""")
    now = int(await session.scalar(text("select extract(epoch from now())")))
    args = {"uid": user, "sid": sid, "aal": "aal1", "verified_at": now,
            "version": 1, "required": False}
    assert _json(await session.scalar(change, args))["error"] == "recent_mfa_required"
    args["aal"] = "aal2"
    args["verified_at"] = now - 301
    assert _json(await session.scalar(change, args))["error"] == "recent_mfa_required"
    args["verified_at"] = now - 10
    changed = _json(await session.scalar(change, args))
    assert changed["require_mfa"] is False and changed["version"] == 2
    assert _json(await session.scalar(change, args))["error"] == "version_conflict"
    args.update({"version": 2, "aal": "aal1", "verified_at": None, "required": True})
    assert _json(await session.scalar(change, args))["require_mfa"] is True
    assert await session.scalar(text("""select count(*) from public.editorial_account_events
      where actor_id=:uid and action='authenticator_choice'"""), {"uid": user}) == 2
    await session.execute(text("delete from auth.sessions where id=:sid"), {"sid": sid})
    args["version"] = 3
    assert _json(await session.scalar(change, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_authenticator(uuid,uuid,text,bigint,integer,boolean)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_authenticator(uuid,uuid,text,bigint,integer,boolean)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_editorial_profile_approval_requires_another_current_admin(session, user):
    sid = uuid.uuid4()
    peer = uuid.uuid4()
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), {"uid": user})
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"),
                          {"sid": sid, "uid": user})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,'owner@example.invalid',array['manage_reviewers'],'Owner','Owner')"""),
      {"uid": user})
    await session.execute(text("insert into auth.users(id,email) values(:uid,'peer@example.invalid')"),
                          {"uid": peer})
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities,requested_name)
      values(:uid,'peer@example.invalid',array['review'],'Peer Name')"""),
      {"uid": peer})
    approve = text("""select public.edge_api_editorial_approve_profile(
      :uid,:sid,:aal,:peer,:version)""")
    args = {"uid": user, "sid": sid, "aal": "aal1", "peer": peer, "version": 1}
    assert _json(await session.scalar(approve, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    args["peer"] = user
    assert _json(await session.scalar(approve, args))["error"] == "self_approval"
    args["peer"] = peer
    approved = _json(await session.scalar(approve, args))
    assert approved["approved_name"] == "Peer Name" and approved["version"] == 2
    assert _json(await session.scalar(approve, args))["error"] == "version_conflict"
    args["version"] = 2
    assert _json(await session.scalar(approve, args))["version"] == 2
    assert await session.scalar(text("""select count(*) from public.editorial_account_events
      where actor_id=:uid and subject_id=:peer and action='profile_approved'"""), args) == 1
    await session.execute(text("delete from auth.sessions where id=:sid"), {"sid": sid})
    assert _json(await session.scalar(approve, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_approve_profile(uuid,uuid,text,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_approve_profile(uuid,uuid,text,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
