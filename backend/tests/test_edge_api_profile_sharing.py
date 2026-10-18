"""Private profile-sharing settings keep revocation and account boundaries."""

import json
import re
import uuid

import pytest
from sqlalchemy import text


GET = text("select public.edge_api_sharing_get(:uid)")
PUT = text("""select public.edge_api_sharing_put(
    :uid, :enabled, :show_name, :show_avatar, :show_bio,
    :show_streak, :show_learning, :codes, :version
)""")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _args(uid, **changes):
    return {"uid": uid, "enabled": False, "show_name": False,
            "show_avatar": False, "show_bio": False, "show_streak": False,
            "show_learning": False, "codes": [], "version": 0, **changes}


@pytest.mark.asyncio
async def test_sharing_is_private_by_default_and_revocation_rotates_the_url(session, user):
    initial = _json(await session.scalar(GET, {"uid": user}))
    assert initial == {"enabled": False, "show_name": False, "show_avatar": False,
                       "show_bio": False, "show_streak": False, "show_learning": False,
                       "achievement_codes": [], "version": 0, "public_path": None}
    first_token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                       {"uid": user})
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", first_token)
    enabled = _json(await session.scalar(PUT, _args(user, enabled=True, show_bio=True)))
    assert enabled["public_path"] == f"/p/{first_token}"
    assert enabled["show_bio"] is True and enabled["version"] == 1
    revoked = _json(await session.scalar(PUT, _args(user, version=1)))
    assert revoked["public_path"] is None and revoked["version"] == 2
    new_token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                     {"uid": user})
    assert new_token != first_token
    restored = _json(await session.scalar(PUT, _args(user, enabled=True, version=2)))
    assert restored["public_path"] == f"/p/{new_token}"
    assert restored["public_path"] != enabled["public_path"]


@pytest.mark.asyncio
async def test_sharing_rejects_stale_versions_and_unearned_achievements(session, user):
    assert _json(await session.scalar(PUT, _args(user, codes=["concept_1"]))) == {
        "error": "unearned_achievements"}
    assert _json(await session.scalar(GET, {"uid": user}))["version"] == 0
    await session.execute(text("""insert into public.user_achievements
      (user_id, achievement_code, earned_on, source)
      values (:uid, 'concept_1', current_date, 'history')"""), {"uid": user})
    selected = _json(await session.scalar(PUT, _args(user, codes=["concept_1", "concept_1"])))
    assert selected["achievement_codes"] == ["concept_1"]
    assert selected["version"] == 1
    assert _json(await session.scalar(PUT, _args(user, version=0))) == {"error": "version_conflict"}
    assert _json(await session.scalar(GET, {"uid": user}))["achievement_codes"] == ["concept_1"]


@pytest.mark.asyncio
async def test_sharing_cannot_read_missing_profile_or_be_called_by_authenticated(session, user):
    assert await session.scalar(GET, {"uid": uuid.uuid4()}) is None
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated', 'public.edge_api_new_profile_token()', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.edge_api_sharing_get(uuid)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.edge_api_sharing_put(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text[],integer)',
        'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_sharing_put(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text[],integer)',
        'EXECUTE')"""))).one()
    assert rights == (False, False, False, True)
