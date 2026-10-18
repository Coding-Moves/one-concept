"""A queued AI correction keeps current authority and source before staging."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


async def seeded_job(session, user):
    await session.execute(text("""update auth.users set email_confirmed_at=now()
      where id=:uid"""), {"uid": user})
    await session.execute(text("""insert into public.editorial_memberships(
      user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,'editorial-worker@example.invalid',
        array['review','request_generation']::text[],
        'Worker Reviewer','Worker Reviewer')"""), {"uid": user})
    topic, subtopic, subslug = (await session.execute(text("""select c.topic_id,
      c.subtopic_id,s.slug from public.concepts c
      join public.subtopics s on s.id=c.subtopic_id limit 1"""))).one()
    suffix = uuid4().hex[:10]
    concept = await session.scalar(text("""insert into public.concepts(
      topic_id,subtopic_id,slug,title,summary,example,status,curriculum)
      values(:topic,:subtopic,:slug,'Test transactions',
        'A complete and published example used only by the test suite.',
        'A shop records payment and stock together during an order.',
        'published','{}'::jsonb) returning id"""),
      {"topic": topic, "subtopic": subtopic, "slug": f"editorial-job-{suffix}"})
    package = {"flashcard": {"front": "What is a transaction?",
                             "back": "A group of related changes."},
               "mcqs": [{"question": f"Question {i} about a transaction?",
                         "options": ["Together", "Separate", "Never", "Unknown"],
                         "correct_index": 0} for i in range(3)]}
    body = {"title": "Test transactions", "summary": "A transaction groups "
            "related database changes. If one fails, all can roll back. "
            "This keeps the records in agreement.",
            "example": "A shop records the payment and stock change together "
            "for one order, or undoes both.", "subtopic_slug": subslug,
            "curriculum": {}, "learning_package": package}
    revision = await session.scalar(text("""insert into public.concept_revisions(
      concept_id,base_version,body,status,assigned_to)
      values(:cid,1,cast(:body as jsonb),'changes_requested',:uid)
      returning id"""),
      {"cid": concept, "body": json.dumps(body), "uid": user})
    feedback = await session.scalar(text("""insert into
      public.editorial_revision_events(revision_id,concept_id,base_version,
      actor_id,registered_name,action,revision_body,source_snapshot,note)
      select :rid,:cid,1,:uid,'Worker Reviewer','changes_requested',
        cast(:body as jsonb),to_jsonb(c)-array['created_at','published_at','status'],
        'Clarify the failed payment example before approval.'
      from public.concepts c where c.id=:cid returning id"""),
      {"rid": revision, "cid": concept, "uid": user, "body": json.dumps(body)})
    request = await session.scalar(text("""insert into
      public.editorial_workflow_events(revision_id,concept_id,topic_id,
      actor_id,registered_name,action,note,details)
      values(:rid,:cid,:tid,:uid,'Worker Reviewer','generation_requested',
        'Please correct the example for this private review.',
        jsonb_build_object('kind','revision','feedback_event_id',cast(:fid as uuid)))
      returning id"""),
      {"rid": revision, "cid": concept, "tid": topic, "uid": user,
       "fid": feedback})
    source_token = await session.scalar(text("""select encode(
      pg_catalog.sha256(convert_to(
        public.edge_api_editorial_python_json(jsonb_build_object(
          'revision',public.edge_api_editorial_revision_token(:rid),
          'siblings',(select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb)
            from public.concept_revisions r where r.concept_id=:cid))),
        'UTF8')),'hex')"""), {"rid": revision, "cid": concept})
    job = await session.scalar(text("""insert into public.editorial_generation_jobs(
      source_revision_id,concept_id,topic_id,feedback_event_id,
      request_event_id,requested_by,source_token,source_body,feedback,available_at)
      values(:rid,:cid,:tid,:fid,:eid,:uid,:token,cast(:body as jsonb),
        'Clarify the failed payment example before approval.',
        now()-interval '2 years') returning id"""),
      {"rid": revision, "cid": concept, "tid": topic, "fid": feedback,
       "eid": request, "uid": user, "token": source_token,
       "body": json.dumps(body)})
    await session.commit()
    return job, concept, revision, package


CLAIM = text("select public.edge_worker_claim_editorial_revision(200,20)")


@pytest.mark.asyncio
async def test_editorial_worker_stages_private_revision_and_fences_old_claim(session, user):
    job, concept, source, package = await seeded_job(session, user)
    assert await session.scalar(text(
      "select public.edge_worker_claim_editorial_revision(0,20)")) is None
    claimed = decoded(await session.scalar(CLAIM))
    assert claimed["id"] == str(job)
    assert claimed["source_body"]["title"] == "Test transactions"
    assert await session.scalar(CLAIM) is None
    await session.commit()
    summary = ("A transaction groups several database changes into one unit. "
               "If one change fails, the database rolls everything back, "
               "keeping the records in agreement.")
    example = ("The shop records payment and reduces stock together. "
               "When payment fails, it leaves stock alone.")
    finish = text("""select public.edge_worker_finish_editorial_revision(
      :id,:token,true,null,:summary,:example,cast(:package as jsonb),
      'gemini-fixture','2026-09-v3-quality')""")
    args = {"id": job, "token": claimed["claim_token"], "summary": summary,
            "example": example, "package": json.dumps(package)}
    assert await session.scalar(finish, args) == "ready_for_review"
    assert await session.scalar(finish, args) == "superseded"
    await session.commit()
    result = (await session.execute(text("""select r.status,r.assigned_to,
      r.body->>'summary' as summary,j.status as job_status
      from public.editorial_generation_jobs j
      join public.concept_revisions r on r.id=j.result_revision_id
      where j.id=:id"""), {"id": job})).one()
    assert result.status == "draft" and result.assigned_to == user
    assert result.summary == summary and result.job_status == "ready_for_review"
    assert await session.scalar(text("""select count(*) from public.concept_revisions
      where concept_id=:cid"""), {"cid": concept}) == 2
    assert await session.scalar(text("""select status from public.concept_revisions
      where id=:rid"""), {"rid": source}) == "changes_requested"


@pytest.mark.asyncio
async def test_editorial_worker_cancels_after_requester_revocation(session, user):
    job, concept, _, _ = await seeded_job(session, user)
    claimed = decoded(await session.scalar(CLAIM))
    await session.execute(text("""update public.editorial_memberships
      set status='revoked' where user_id=:uid"""), {"uid": user})
    await session.commit()
    state = await session.scalar(text("""select public.edge_worker_finish_editorial_revision(
      :id,:token,true,'provider_error',null,null,null,null,null)"""),
      {"id": job, "token": claimed["claim_token"]})
    assert state == "cancelled"
    assert await session.scalar(text("""select count(*) from public.concept_revisions
      where concept_id=:cid"""), {"cid": concept}) == 1
