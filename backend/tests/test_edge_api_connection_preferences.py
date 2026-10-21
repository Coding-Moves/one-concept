"""Connection invitation preferences use the verified owner and an optimistic version."""

import json
import uuid

import pytest
from sqlalchemy import text


GET = text("select public.edge_api_connection_settings_get(:uid)")
PUT = text("select public.edge_api_connection_settings_put(:uid,:accepting,:version)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_connection_settings_default_version_update_and_conflict(session, user):
    assert _json(await session.scalar(GET, {"uid": user})) == {
        "accepting_requests": False, "version": 0}
    enabled = _json(await session.scalar(PUT, {
        "uid": user, "accepting": True, "version": 0}))
    assert enabled == {"accepting_requests": True, "version": 1}
    assert _json(await session.scalar(PUT, {
        "uid": user, "accepting": False, "version": 0})) == {
        "error": "version_conflict"}
    assert _json(await session.scalar(GET, {"uid": user})) == enabled
    disabled = _json(await session.scalar(PUT, {
        "uid": user, "accepting": False, "version": 1}))
    assert disabled == {"accepting_requests": False, "version": 2}


@pytest.mark.asyncio
async def test_connection_settings_cannot_modify_missing_or_other_account(session, user):
    other = uuid.uuid4()
    assert await session.scalar(GET, {"uid": other}) is None
    assert await session.scalar(PUT, {"uid": other, "accepting": True, "version": 0}) is None
    assert _json(await session.scalar(GET, {"uid": user})) == {
        "accepting_requests": False, "version": 0}
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated', 'public.edge_api_connection_settings_get(uuid)', 'EXECUTE'),
      has_function_privilege('authenticated',
        'public.edge_api_connection_settings_put(uuid,boolean,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connection_settings_put(uuid,boolean,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, False, True)
