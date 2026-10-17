"""Editorial RPCs preserve Python's full six-digit microsecond encoding."""

import json
import uuid

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_timestamp_helper_keeps_trailing_and_leading_zeroes(session):
    values = (await session.execute(text("""select
      public.edge_api_editorial_utc_iso('2026-10-17 08:30:09.210050+00'),
      public.edge_api_editorial_utc_iso('2026-10-17 08:30:09.000001+00'),
      public.edge_api_editorial_utc_iso('2026-10-17 08:30:09+00')"""))).one()
    assert values == (
        "2026-10-17T08:30:09.210050+00:00",
        "2026-10-17T08:30:09.000001+00:00",
        "2026-10-17T08:30:09+00:00",
    )
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_utc_iso_exact(timestamp with time zone)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_utc_iso_exact(timestamp with time zone)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_editorial_history_activity_and_timeline_keep_microseconds(api, session, draft):
    revision = await session.scalar(text("""select id from public.concept_revisions
      where concept_id=:cid limit 1"""), {"cid": draft[1]})
    topic = await session.scalar(text("select topic_id from public.concepts where id=:cid"),
                                 {"cid": draft[1]})
    event = uuid.uuid4()
    await session.execute(text("""update public.concept_revisions set
      created_at='2026-10-17 08:30:09.210050+00'::timestamptz where id=:rid"""),
      {"rid": revision})
    await session.execute(text("""insert into public.editorial_workflow_events
      (id,concept_id,topic_id,actor_id,registered_name,action,note,details,created_at)
      values(:id,:cid,:topic,:actor,'Initial Owner','comment',
        'Verified the timestamp serialization.','{}'::jsonb,
        '2026-10-17 08:30:09.210050+00'::timestamptz)"""),
      {"id": event, "cid": draft[1], "topic": topic, "actor": api.owner.id})
    await session.commit()
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "cid": draft[1], "topic": topic}
    history = _json(await session.scalar(text("""select public.edge_api_editorial_revision_history(
      :uid,:sid,:aal,:cid,null,25)"""), args))
    history_http = await api.client.get(
        f"{content.ROOT}/concepts/{draft[1]}/revisions", headers=api.headers())
    assert history_http.status_code == 200, history_http.text
    assert history == history_http.json()
    assert history["items"][0]["created_at"].endswith(".210050+00:00")
    activity = _json(await session.scalar(text("""select public.edge_api_editorial_activity(
      :uid,:sid,:aal,null,:topic,25)"""), args))
    activity_http = await api.client.get(f"{content.ROOT}/activity",
        params={"topic_id": str(topic)}, headers=api.headers())
    assert activity_http.status_code == 200, activity_http.text
    assert activity == activity_http.json()
    item = next(item for item in activity["items"] if item["id"] == str(event))
    assert item["created_at"].endswith(".210050+00:00")
    timeline = _json(await session.scalar(text("""select public.edge_api_editorial_concept_timeline(
      :uid,:sid,:aal,:cid,null,null,25)"""), args))
    timeline_http = await api.client.get(
        f"{content.ROOT}/concepts/{draft[1]}/timeline", headers=api.headers())
    assert timeline_http.status_code == 200, timeline_http.text
    assert timeline == timeline_http.json()
    item = next(item for item in timeline["items"] if item["id"] == f"w:{event}")
    assert item["created_at"].endswith(".210050+00:00")
