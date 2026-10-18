"""Reviewer invitations bind exactly one existing or newly invited Auth user."""

import json

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content
from tests.test_editorial_api import auth_account


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_invite_existing_identity_rechecks_authority_and_audits(api, session):
    reviewer, _, email = await auth_account(session)
    prepare = text("""select public.edge_api_editorial_invite_prepare(
      :uid,:sid,:aal,:email)""")
    finish = text("""select public.edge_api_editorial_invite_finish(
      :uid,:sid,:aal,:email,:reviewer,:caps)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "email": email, "reviewer": reviewer,
            "caps": ["review", "approve", "review"]}
    result = _json(await session.scalar(prepare, args))
    assert result == {"user_id": str(reviewer), "needs_invite": False}
    assert _json(await session.scalar(finish,
      {**args, "reviewer": api.owner.id}))["error"] == "identity_not_ready"
    member = _json(await session.scalar(finish, args))
    assert member["user_id"] == str(reviewer)
    assert member["invited_email"] == email
    assert member["capabilities"] == ["approve", "review"]
    assert member["version"] == 1
    await session.commit()
    saved = await api.client.get(f"{content.ROOT}/reviewers", headers=api.headers())
    assert saved.status_code == 200, saved.text
    assert any(item["user_id"] == str(reviewer) for item in saved.json()["items"])
    assert _json(await session.scalar(prepare, args))["error"] == "reviewer_exists"
    assert _json(await session.scalar(finish, args))["error"] == "reviewer_exists"
    assert _json(await session.scalar(prepare, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    audit = (await session.execute(text("""select details from public.editorial_account_events
      where subject_id=:reviewer and action='invite'"""), args)).scalars().all()
    assert len(audit) == 1 and audit[0]["capabilities"] == ["approve", "review"]
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_invite_prepare(uuid,uuid,text,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_invite_prepare(uuid,uuid,text,text)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.edge_api_editorial_invite_finish(uuid,uuid,text,text,uuid,text[])', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_invite_finish(uuid,uuid,text,text,uuid,text[])', 'EXECUTE')"""))).one()
    assert rights == (False, True, False, True)
    await session.execute(text("delete from public.editorial_account_events where subject_id=:reviewer"), args)
    await session.execute(text("delete from auth.users where id=:reviewer"), args)
    await session.commit()


@pytest.mark.asyncio
async def test_existing_reviewer_invite_reads_auth_as_service_role(api, session):
    reviewer, _, email = await auth_account(session)
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "email": email, "reviewer": reviewer,
            "caps": ["review"]}
    try:
        await session.execute(text("set local role service_role"))
        prepared = _json(await session.scalar(text("""select public.edge_api_editorial_invite_prepare(
          :uid,:sid,:aal,:email)"""), args))
        assert prepared == {"user_id": str(reviewer), "needs_invite": False}
        enrolled = _json(await session.scalar(text("""select public.edge_api_editorial_invite_finish(
          :uid,:sid,:aal,:email,:reviewer,:caps)"""), args))
        assert enrolled["user_id"] == str(reviewer)
        assert enrolled["capabilities"] == ["review"]
    finally:
        await session.execute(text("reset role"))
    for signature in (
        "public.edge_api_editorial_reviewer_access(uuid,uuid,text,uuid,integer,text,text[])",
        "public.edge_api_editorial_invite_prepare(uuid,uuid,text,text)",
        "public.edge_api_editorial_invite_finish(uuid,uuid,text,text,uuid,text[])",
    ):
        assert await session.scalar(text("""select prosecdef and
          proconfig @> array['search_path=""']::text[] from pg_proc
          where oid=to_regprocedure(:signature)"""), {"signature": signature}) is True
    await session.commit()
