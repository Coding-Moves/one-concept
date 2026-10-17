"""Versioned owner notification policy writes keep the original lock and audit contract."""

import json

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_policy_matches_backend_and_rejects_stale_writes(api, session):
    current = await session.scalar(text("""select version from
      public.editorial_notification_policy where singleton"""))
    path = f"{content.ROOT}/notifications/policy"
    http = await api.client.patch(path, headers=api.headers(), json={
        "expected_version": current, "deadline_hours": 49,
        "reminder_hours": 25, "max_reminders": 3,
    })
    assert http.status_code == 200, http.text
    assert http.json()["version"] == current + 1
    command = text("""select public.edge_api_editorial_notification_policy(
      :uid,:sid,:aal,:version,:deadline,:reminder,:maximum)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "version": current + 1, "deadline": 48, "reminder": 24, "maximum": 2}
    result = _json(await session.scalar(command, args))
    assert result == {
        "singleton": True, "version": current + 2,
        "deadline_hours": 48, "reminder_hours": 24, "max_reminders": 2,
    }
    assert result == _json(await session.scalar(text("""select to_jsonb(p) from
      public.editorial_notification_policy p where singleton""")))
    assert _json(await session.scalar(command, args))["error"] == "policy_conflict"
    assert (await session.execute(text("""select count(*) from
      public.editorial_account_events where action='notification_policy'
      and actor_id=:uid"""), args)).scalar_one() >= 2
    args["version"] = current + 2
    args["deadline"] = 0
    assert _json(await session.scalar(command, args))["error"] == "invalid_policy"
    args["deadline"] = 48
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_notification_policy(uuid,uuid,text,integer,integer,integer,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_notification_policy(uuid,uuid,text,integer,integer,integer,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
