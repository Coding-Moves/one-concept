"""Profile edits preserve server timezone rules and private avatar ownership."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)
PATCH = text("""
    select public.edge_api_patch_profile(
      :uid, :name, :has_bio, :bio, :preset, :timezone, :initialize, :compact, :day
    )
""")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _args(user, **changes):
    return {"uid": user, "name": None, "has_bio": False, "bio": None,
            "preset": None, "timezone": None, "initialize": False,
            "compact": True, "day": DAY, **changes}


@pytest.mark.asyncio
async def test_profile_patch_returns_snapshot_without_selecting_daily(session, user):
    old_ref = f"avatars/{user}/{'a' * 32}.jpg"
    await session.execute(text("update public.profiles set avatar_url=:ref where id=:uid"),
                          {"ref": old_ref, "uid": user})
    result = _json(await session.scalar(PATCH, _args(
        user, name="Muawiya", has_bio=True, bio="Learning daily",
        preset="aurora", timezone="Asia/Karachi", initialize=True,
    )))
    assert result["old_avatar_ref"] == old_ref
    state = result["state"]
    assert state["display_name"] == "Muawiya"
    assert state["bio"] == "Learning daily"
    assert state["avatar_ref"] == "preset:aurora"
    assert state["timezone"] == "Asia/Karachi"
    assert state["daily"] is None
    assert await session.scalar(text("select count(*) from public.daily_assignments where user_id=:uid"),
                                {"uid": user}) == 0
    assert await session.scalar(text("select timezone_initialized from public.profiles where id=:uid"),
                                {"uid": user}) is True
    ignored_initialization = _json(await session.scalar(PATCH, _args(
        user, has_bio=True, bio=None, timezone="UTC", initialize=True,
    )))
    assert ignored_initialization["state"]["timezone"] == "Asia/Karachi"
    assert ignored_initialization["state"]["bio"] is None
    changed = _json(await session.scalar(PATCH, _args(user, timezone="UTC")))
    assert changed["state"]["timezone"] == "UTC"


@pytest.mark.asyncio
async def test_unknown_timezone_rejects_the_whole_edit_and_only_profile_is_mutable(session, user):
    old = await session.scalar(text("select display_name from public.profiles where id=:uid"),
                               {"uid": user})
    rejected = _json(await session.scalar(PATCH, _args(
        user, name="Unexpected", timezone="Not/A/Zone",
    )))
    assert rejected == {"error": "unknown_timezone"}
    assert await session.scalar(text("select display_name from public.profiles where id=:uid"),
                                {"uid": user}) == old
    assert await session.scalar(PATCH, _args(uuid.uuid4(), name="No account")) is None
    permissions = (await session.execute(text("""
        select
          has_function_privilege('authenticated',
            'public.edge_api_patch_profile(uuid,text,boolean,text,text,text,boolean,boolean,date)', 'EXECUTE'),
          has_function_privilege('service_role',
            'public.edge_api_patch_profile(uuid,text,boolean,text,text,text,boolean,boolean,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, True)
