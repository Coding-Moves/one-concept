"""Legacy batch entries remain private to current review members."""

import json
import uuid

import pytest
from sqlalchemy import text


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_legacy_entries_are_filtered_by_batch_and_authorized(session, user):
    sid = uuid.uuid4()
    topic = uuid.uuid4()
    concept = uuid.uuid4()
    batch = uuid.uuid4()
    entry = uuid.uuid4()
    args = {"uid": user, "sid": sid, "aal": "aal2", "batch": batch}
    read = text("select public.edge_api_editorial_legacy_entries(:uid,:sid,:aal,:batch)")
    await session.execute(text("update auth.users set email_confirmed_at=now() where id=:uid"), args)
    await session.execute(text("insert into auth.sessions(id,user_id) values(:sid,:uid)"), args)
    await session.execute(text("""insert into public.editorial_memberships
      (user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,'reviewer@example.invalid',array['review'],'Reviewer Name','Reviewer Name')"""), args)
    await session.execute(text("""insert into public.topics(id,slug,name)
      values(:id,:slug,'Legacy Topic')"""),
      {"id": topic, "slug": f"legacy-entries-{topic}"})
    await session.execute(text("""insert into public.concepts(id,topic_id,slug,title,summary)
      values(:id,:topic,:slug,'Legacy Lesson','Summary for lesson')"""),
      {"id": concept, "topic": topic, "slug": f"legacy-entries-{concept}"})
    await session.execute(text("""insert into public.editorial_legacy_batches
      (id,topic_id,name,requested_by,model,prompt_version,quota_limit)
      values(:id,:topic,:name,:uid,'gemini-3','v1',1)"""),
      {"id": batch, "topic": topic, "name": f"test-{batch}", "uid": user})
    await session.execute(text("""insert into public.editorial_legacy_batch_entries
      (id,batch_id,concept_id,base_version,source_body)
      values(:id,:batch,:concept,1,'{}'::jsonb)"""),
      {"id": entry, "batch": batch, "concept": concept})
    rows = _json(await session.scalar(read, args))["items"]
    assert rows == [{
        "id": str(entry), "concept_id": str(concept), "title": "Legacy Lesson",
        "base_version": 1, "attempts": 0, "status": "queued",
        "result_revision_id": None, "failure_code": None,
    }]
    args["batch"] = uuid.uuid4()
    assert _json(await session.scalar(read, args))["error"] == "batch_not_found"
    args["batch"] = batch
    args["aal"] = "aal1"
    assert _json(await session.scalar(read, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['approve'] where user_id=:uid"""), args)
    assert _json(await session.scalar(read, args))["error"] == "permission"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("""grant select on public.editorial_legacy_batches,
      public.editorial_legacy_batch_entries, public.concepts,
      public.concept_revisions to service_role"""))
    await session.execute(text("set local role service_role"))
    assert _json(await session.scalar(read, args))["items"][0]["id"] == str(entry)
    await session.execute(text("reset role"))
    await session.execute(text("delete from auth.sessions where id=:sid"), args)
    assert _json(await session.scalar(read, args))["error"] == "session_required"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_legacy_entries(uuid,uuid,text,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_legacy_entries(uuid,uuid,text,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
