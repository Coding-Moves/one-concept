"""Owner event feed allows only metadata and preserves exact event cursors."""

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
async def test_owner_events_match_backend_filters_and_cursor(api, session):
    correlation = uuid.uuid4()
    ids = (uuid.uuid4(), uuid.uuid4())
    await session.execute(text("""insert into public.owner_operation_events
      (id,service,code,severity,correlation_id,observed_at) values
      (:first,'api','unexpected_failure','error',:correlation,now()-interval '1 minute'),
      (:second,'api','database_unavailable','error',:correlation,now()-interval '2 minutes')"""),
      {"first": ids[0], "second": ids[1], "correlation": correlation})
    await session.commit()
    command = text("""select public.edge_api_editorial_owner_events(
      :uid,:sid,:aal,:start,:end,:source,:severity,:search,:correlation,
      :before_time,:before_key,:limit)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "start": None, "end": None, "source": "api", "severity": "error",
            "search": None, "correlation": correlation, "before_time": None,
            "before_key": None, "limit": 1}
    for page in range(2):
        params = {"source": "api", "severity": "error",
                  "correlation": correlation.hex, "limit": 1}
        if args["before_time"] is not None:
            params["cursor"] = f"{args['before_time']}~{args['before_key']}"
        expected = await api.client.get(f"{content.ROOT}/owner/events",
                                        params=params, headers=api.headers())
        assert expected.status_code == 200, expected.text
        result = _json(await session.scalar(command, args))
        body = expected.json()
        at_sql = datetime.fromisoformat(result.pop("observed_at"))
        at_http = datetime.fromisoformat(body.pop("observed_at"))
        assert abs((at_sql-at_http).total_seconds()) < 3
        assert result == body
        assert len(result["items"]) == 1
        assert set(result["items"][0]) == {
          "key", "observed_at", "source", "action", "severity", "correlation_id"}
        if page == 0:
            stamp, key = result["next_cursor"].split("~", 1)
            args["before_time"] = datetime.fromisoformat(stamp)
            args["before_key"] = key
        else:
            assert result["next_cursor"] is None
    assert _json(await session.scalar(command, {**args, "limit": 51}))["error"] == "invalid_page"
    assert _json(await session.scalar(command, {**args, "aal": "aal1"}))["error"] == "mfa_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_owner_events(uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_owner_events(uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
    await session.execute(text("delete from public.owner_operation_events where id in (:first,:second)"),
                          {"first": ids[0], "second": ids[1]})
    await session.commit()
