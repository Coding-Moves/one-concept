"""Owner health reports contain bounded aggregates and current worker evidence."""

import json
import uuid
from datetime import datetime

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_owner_operations_matches_backend_flags_and_worker_status(api, session):
    await session.execute(text("""insert into public.owner_operation_events
      (service,code,severity,correlation_id,observed_at) values
      ('reminders','completed','info',:recent,now()-interval '1 minute'),
      ('pool_topup','failed','error',:stale,now()-interval '3 days')"""),
      {"recent": uuid.uuid4(), "stale": uuid.uuid4()})
    await session.commit()
    command = text("""select public.edge_api_editorial_owner_operations(
      :uid,:sid,:aal,:environment,:telemetry,:generation,:future,
      :legacy,:auto,:email,:cap)""")
    settings = api.settings
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "environment": settings.environment,
            "telemetry": settings.owner_telemetry_enabled,
            "generation": settings.generation_enabled,
            "future": settings.future_refill_enabled,
            "legacy": settings.legacy_enrichment_enabled,
            "auto": settings.editorial_auto_correction_enabled,
            "email": settings.editorial_email_enabled,
            "cap": settings.generation_daily_call_cap}
    expected = await api.client.get(f"{content.ROOT}/owner/operations",
                                    headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(command, args))
    body = expected.json()
    at_sql = datetime.fromisoformat(result.pop("observed_at"))
    at_http = datetime.fromisoformat(body.pop("observed_at"))
    assert abs((at_sql-at_http).total_seconds()) < 3
    assert result == body
    assert result["workers"][0]["status"] == "completed"
    assert result["workers"][1]["status"] == "stale"
    assert "Private body" not in json.dumps(result)
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_owner_operations(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_owner_operations(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
