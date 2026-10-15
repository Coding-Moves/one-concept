"""Notification and push-token Edge RPC contracts on real PostgreSQL."""

import json
import uuid

import pytest
from sqlalchemy import text


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_edge_notification_preferences_preserve_omitted_weekly_choice(session, user):
    get = text("select public.edge_api_notifications(:uid)")
    original = _json(await session.scalar(get, {"uid": user}))
    assert original == {
        "enabled": True, "weekly_quiz_enabled": False,
        "reminder_times": ["08:00", "14:00", "20:00"],
    }
    save = text("select public.edge_api_set_notifications(:uid, :enabled, :weekly, :times)")
    updated = _json(await session.scalar(save, {
        "uid": user, "enabled": False, "weekly": None,
        "times": ["20:00", "08:00", "08:00"],
    }))
    assert updated == {
        "enabled": False, "weekly_quiz_enabled": False,
        "reminder_times": ["08:00", "20:00"],
    }
    weekly = _json(await session.scalar(save, {
        "uid": user, "enabled": False, "weekly": True,
        "times": ["08:00"],
    }))
    assert weekly["weekly_quiz_enabled"] is True
    assert _json(await session.scalar(get, {"uid": user})) == weekly


@pytest.mark.asyncio
async def test_edge_push_token_rehomes_and_deletes_only_caller_registration(session, user):
    other = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:id,:email)"), {
        "id": other, "email": f"{other}@example.invalid",
    })
    call = text("select public.edge_api_push_token(:uid, :token, :platform, :register)")
    token = "ExponentPushToken[staging-test-device]"
    assert await session.scalar(call, {"uid": user, "token": token, "platform": "android", "register": True}) is True
    assert await session.scalar(call, {"uid": other, "token": token, "platform": None, "register": True}) is True
    await session.scalar(call, {"uid": user, "token": token, "platform": None, "register": False})
    owner = await session.scalar(text("select user_id from public.device_tokens where expo_push_token=:token"), {"token": token})
    assert owner == other
    await session.scalar(call, {"uid": other, "token": None, "platform": None, "register": False})
    assert await session.scalar(text("select count(*) from public.device_tokens where expo_push_token=:token"), {"token": token}) == 0


@pytest.mark.asyncio
async def test_edge_notification_rpc_permissions(session):
    rows = (
        await session.execute(text("""
            select
              has_function_privilege('authenticated', 'public.edge_api_notifications(uuid)', 'EXECUTE'),
              has_function_privilege('authenticated', 'public.edge_api_set_notifications(uuid,boolean,boolean,text[])', 'EXECUTE'),
              has_function_privilege('authenticated', 'public.edge_api_push_token(uuid,text,text,boolean)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.edge_api_notifications(uuid)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.edge_api_set_notifications(uuid,boolean,boolean,text[])', 'EXECUTE'),
              has_function_privilege('service_role', 'public.edge_api_push_token(uuid,text,text,boolean)', 'EXECUTE')
        """))
    ).one()
    assert rows == (False, False, False, True, True, True)
