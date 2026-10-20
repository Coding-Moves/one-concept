"""Owner reporting switches to durable Edge runs when scheduled jobs are enabled."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_owner_reports_edge_job_status_and_private_events(api, session):
    savepoint = await session.begin_nested()
    try:
        run_id = uuid4()
        await session.execute(text("""update public.edge_worker_jobs
          set enabled=true where name='daily_reminders'"""))
        await session.execute(text("""insert into public.edge_worker_runs
          (id,job,scheduled_for,status,queued_at,started_at,finished_at,error_code)
          values (:id,'daily_reminders',now()-interval '1 minute','failed',
          now()-interval '1 minute',now()-interval '1 minute',now(),'provider_error')"""),
          {"id": run_id})
        owner = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2"}
        health = _json(await session.scalar(text("""select
          public.edge_api_editorial_owner_operations(
          :uid,:sid,:aal,'staging',true,false,false,false,false,false,1)"""), owner))
        workers = {item["service"]: item for item in health["workers"]}
        assert len(workers) == 7
        assert workers["daily_reminders"]["status"] == "failed"
        assert workers["daily_reminders"]["observation"]["correlation_id"] == str(run_id)
        assert workers["weekly_quiz"]["status"] == "disabled"
        assert "provider_error" not in json.dumps(health)

        events = _json(await session.scalar(text("""select
          public.edge_api_editorial_owner_events(
          :uid,:sid,:aal,null,null,'reminders','error',null,:correlation,
          null,null,10)"""), owner | {"correlation": run_id}))
        assert len(events["items"]) == 1
        assert events["items"][0]["action"] == "daily_reminders:failed"
        assert events["items"][0]["correlation_id"] == str(run_id)
        assert "provider_error" not in json.dumps(events)

        denied = _json(await session.scalar(text("""select
          public.edge_api_editorial_owner_operations(
          :uid,:sid,'aal1','staging',true,false,false,false,false,false,1)"""), owner))
        assert denied["error"] == "mfa_required"
    finally:
        await savepoint.rollback()
