"""Curated refill reserves Pacific-day quota before one private draft."""

import json
from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import text


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.fixture(autouse=True)
async def isolate_curated_topics(session):
    yield
    await session.rollback()
    await session.execute(text("""delete from public.daily_assignments a
      using public.concepts c,public.topics t where a.concept_id=c.id
      and c.topic_id=t.id and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.concept_revisions r
      using public.concepts c,public.topics t where r.concept_id=c.id
      and c.topic_id=t.id and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.content_supply_targets s
      using public.topics t where s.topic_id=t.id
      and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.future_refill_topic_daily_usage u
      using public.topics t where u.topic_id=t.id
      and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.user_topics u
      using public.topics t where u.topic_id=t.id
      and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.concept_backlog b
      using public.topics t where b.topic_id=t.id
      and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.concepts c
      using public.topics t where c.topic_id=t.id
      and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.subtopics s
      using public.topics t where s.topic_id=t.id
      and t.slug like 'worker-refill-%'"""))
    await session.execute(text("""delete from public.topics
      where slug like 'worker-refill-%'"""))
    await session.commit()


async def seeded_topic(session, user):
    suffix = uuid4().hex[:10]
    topic = await session.scalar(text("""insert into public.topics(slug,name)
      values (:slug,'Worker refill test') returning id"""),
      {"slug": f"worker-refill-{suffix}"})
    subtopic = await session.scalar(text("""insert into public.subtopics(
      topic_id,slug,name) values (:tid,'core','Core concepts') returning id"""),
      {"tid": topic})
    concept = await session.scalar(text("""insert into public.concepts(
      topic_id,subtopic_id,slug,title,summary,status)
      values (:tid,:sid,:slug,'Known lesson','A published test lesson','published')
      returning id"""),
      {"tid": topic, "sid": subtopic, "slug": f"known-{suffix}"})
    await session.execute(text("""insert into public.user_topics(user_id,topic_id)
      values (:uid,:tid) on conflict do nothing"""), {"uid": user, "tid": topic})
    await session.execute(text("""insert into public.daily_assignments(
      user_id,concept_id,assigned_for) values (:uid,:cid,:day)"""),
      {"uid": user, "cid": concept, "day": date(2025, 1, 1)})
    backlog = await session.scalar(text("""insert into public.concept_backlog(
      topic_id,subtopic_id,slug,title,angle,curriculum)
      values (:tid,:sid,:slug,'A queued lesson','Show a concrete example',
      '{"objective":"Explain the idea"}'::jsonb) returning id"""),
      {"tid": topic, "sid": subtopic, "slug": f"queued-{suffix}"})
    await session.commit()
    assert await session.scalar(text(
      "select public.edge_worker_plan_active_readers(90,60,10)")) >= 1
    await session.commit()
    return topic, backlog


CLAIM = text("""select public.edge_worker_claim_curated_refill(
  :topic,false,90,10,25,100,2,20,25)""")


@pytest.mark.asyncio
async def test_refill_claim_reap_and_private_draft_are_fenced(session, user):
    topic, backlog = await seeded_topic(session, user)
    first = decoded(await session.scalar(CLAIM, {"topic": topic}))
    assert first["id"] == str(backlog)
    assert first["curriculum"]["objective"] == "Explain the idea"
    assert await session.scalar(CLAIM, {"topic": topic}) is None
    await session.execute(text("""update public.concept_backlog
      set claimed_at=now()-interval '31 minutes' where id=:id"""),
      {"id": backlog})
    await session.commit()
    second = decoded(await session.scalar(CLAIM, {"topic": topic}))
    assert second["id"] == str(backlog)
    assert second["claim_token"] != first["claim_token"]
    await session.commit()
    summary = ("A small transaction keeps related changes together. "
               "If one fails, the database can roll them back, leaving the records in agreement.")
    example = ("A shop records a payment and reduces stock together. "
               "If payment fails, the item stays available.")
    package = {"flashcard": {"front": "What does this idea keep together?",
                            "back": "It keeps related changes together."},
               "mcqs": [{"question": f"Question {index} about the lesson?",
                         "options": ["One", "Two", "Three", "Four"],
                         "correct_index": 0} for index in range(3)]}
    complete = text("""select public.edge_worker_complete_curated_refill(
      :id,:token,:summary,:example,cast(:package as jsonb),
      'gemini-fixture','2026-09-v3-quality')""")
    args = {"id": backlog, "token": first["claim_token"], "summary": summary,
            "example": example, "package": json.dumps(package)}
    assert await session.scalar(complete, args) is False
    args["token"] = second["claim_token"]
    assert await session.scalar(complete, args) is True
    await session.commit()
    row = (await session.execute(text("""select c.status,r.status as revision_status
      from public.concept_backlog b join public.concepts c on c.slug=b.slug
      join public.concept_revisions r on r.concept_id=c.id
      where b.id=:id"""), {"id": backlog})).one()
    assert row.status == "draft" and row.revision_status == "draft"
    assert await session.scalar(text("""select calls_used from
      public.future_refill_topic_daily_usage where topic_id=:tid"""),
      {"tid": topic}) == 2
    await session.commit()


@pytest.mark.asyncio
async def test_rate_limit_releases_title_but_not_spent_allowance(session, user):
    topic, backlog = await seeded_topic(session, user)
    first = decoded(await session.scalar(CLAIM, {"topic": topic}))
    assert await session.scalar(text("""select public.edge_worker_release_curated_refill(
      :id,:token,'rate_limited')"""),
      {"id": backlog, "token": first["claim_token"]}) is True
    await session.commit()
    row = (await session.execute(text("""select status,attempts from public.concept_backlog
      where id=:id"""), {"id": backlog})).one()
    assert row.status == "pending" and row.attempts == 0
    assert await session.scalar(text("""select calls_used from
      public.future_refill_topic_daily_usage where topic_id=:tid"""),
      {"tid": topic}) == 1
    await session.commit()
