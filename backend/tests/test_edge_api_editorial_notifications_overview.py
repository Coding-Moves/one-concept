"""Owner delivery overview remains private, bounded, and free of email bodies."""

import json
import uuid

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_notifications_overview_matches_backend_and_role_gate(api, session):
    batch = uuid.uuid4()
    await session.execute(text("""insert into public.editorial_email_batches
      (id,recipient_id,recipient_email,subject,body,status,attempts,failure_code,created_at)
      values(:id,:uid,'recipient@example.invalid','Private subject','Private body',
        'failed',1,'sender_error','2026-10-17 08:30:09.210050+00'::timestamptz)"""),
      {"id": batch, "uid": api.owner.id})
    await session.commit()
    read = text("""select public.edge_api_editorial_notifications_overview(
      :uid,:sid,:aal,:cursor,:limit,:setup,:cap)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "cursor": None, "limit": 100, "setup": "disabled",
            "cap": api.settings.editorial_email_daily_cap}
    expected = await api.client.get(f"{content.ROOT}/notifications",
                                    params={"limit": 100}, headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(read, args))
    assert result == expected.json()
    item = next(item for item in result["items"] if item["id"] == str(batch))
    assert item["created_at"].endswith(".210050+00:00")
    assert "Private body" not in json.dumps(result)
    args["cursor"] = uuid.UUID("ffffffff-ffff-4fff-bfff-fffffffffff0")
    assert _json(await session.scalar(read, args))["items"] == []
    args["cursor"] = None
    args["limit"] = 101
    assert _json(await session.scalar(read, args))["error"] == "invalid_page"
    args["limit"] = 25
    args["aal"] = "aal1"
    assert _json(await session.scalar(read, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(read, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_notifications_overview(uuid,uuid,text,uuid,integer,text,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_notifications_overview(uuid,uuid,text,uuid,integer,text,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
