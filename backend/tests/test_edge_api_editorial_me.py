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
    args["cursor"] = uuid.UUID(first["next_cursor"])
    second = _json(await session.scalar(page, args))
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    assert {first["items"][0]["user_id"], second["items"][0]["user_id"]} == {str(user), str(peer)}
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
