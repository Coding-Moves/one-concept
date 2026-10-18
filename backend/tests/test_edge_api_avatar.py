"""Avatar references remain private, owner-bound, and service-only."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text


SET = text("select public.edge_api_set_avatar(:uid,:key,:compact,:day)")


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_avatar_replacement_and_removal_return_old_private_key(session, user):
    first = f"avatars/{user}/{'a' * 32}.jpg"
    second = f"avatars/{user}/{'b' * 32}.jpg"
    args = {"uid": user, "compact": True, "day": date(2026, 10, 15)}
    initial = decoded(await session.scalar(SET, {**args, "key": first}))
    assert initial["old_avatar_ref"] is None
    assert initial["state"]["avatar_ref"] == first
    replaced = decoded(await session.scalar(SET, {**args, "key": second}))
    assert replaced["old_avatar_ref"] == first
    assert replaced["state"]["avatar_ref"] == second
    removed = decoded(await session.scalar(SET, {**args, "key": None}))
    assert removed["old_avatar_ref"] == second
    assert removed["state"]["avatar_ref"] is None


@pytest.mark.asyncio
async def test_avatar_rejects_other_users_keys_and_requires_service_role(session, user):
    args = {"uid": user, "compact": False, "day": date(2026, 10, 15)}
    for key in (f"avatars/{uuid.uuid4()}/{'c' * 32}.jpg",
                f"avatars/{user}/{'d' * 32}Xjpg", "avatars/../secret.jpg"):
        assert decoded(await session.scalar(SET, {**args, "key": key})) == {"error": "invalid"}
    assert await session.scalar(text("select avatar_url from public.profiles where id=:uid"),
                                {"uid": user}) is None
    assert await session.scalar(SET, {**args, "uid": uuid.uuid4(), "key": None}) is None
    permissions = (await session.execute(text("""
        select has_function_privilege('authenticated',
                 'public.edge_api_set_avatar(uuid,text,boolean,date)', 'EXECUTE'),
               has_function_privilege('service_role',
                 'public.edge_api_set_avatar(uuid,text,boolean,date)', 'EXECUTE')
    """))).one()
    assert permissions == (False, True)
