"""Legacy eligibility preserves the old aggregate without exposing source bodies."""

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
async def test_editorial_legacy_eligibility_matches_backend_and_role_gate(api, session, draft):
    topic, subtopic = (await session.execute(text("""select topic_id,subtopic_id
      from public.concepts where id=:id"""), {"id": draft[1]})).one()
    concept = uuid.uuid4()
    await session.execute(text("""insert into public.concepts
      (id,topic_id,subtopic_id,slug,title,summary,status)
      values(:id,:topic,:subtopic,:slug,'Legacy Lesson','Legacy summary','published')"""),
      {"id": concept, "topic": topic, "subtopic": subtopic,
       "slug": f"legacy-eligibility-{concept}"})
    await session.commit()
    read = text("""select public.edge_api_editorial_legacy_eligibility(
      :uid,:sid,:aal,:topic,:configured)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal2",
            "topic": topic, "configured": bool(api.settings.generation_enabled
              and api.settings.legacy_enrichment_enabled and api.settings.gemini_api_key
              and api.settings.gemini_model.startswith("gemini-3"))}
    expected = await api.client.get(
        f"{content.ROOT}/legacy-enrichment-eligibility/{topic}", headers=api.headers())
    assert expected.status_code == 200, expected.text
    result = _json(await session.scalar(read, args))
    assert result == expected.json()
    assert result["eligible_count"] == 1
    assert "source_body" not in result
    args["topic"] = uuid.uuid4()
    assert _json(await session.scalar(read, args))["error"] == "active_topic_not_found"
    args["topic"] = topic
    args["aal"] = "aal1"
    assert _json(await session.scalar(read, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(read, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['request_generation'] where user_id=:uid"""), args)
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("""grant select on public.topics,public.subtopics,
      public.concepts,public.editorial_publications,public.concept_revisions,
      public.editorial_legacy_batch_entries,public.editorial_legacy_batches
      to service_role"""))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(read, args))["eligible_count"] == 1
    await session.execute(text("reset role"))
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_legacy_eligibility(uuid,uuid,text,uuid,boolean)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_legacy_eligibility(uuid,uuid,text,uuid,boolean)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
