"""Owner-selected legacy batches stage only grounded private revisions."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.fixture(autouse=True)
async def isolate_legacy_worker(session):
    yield
    await session.rollback()
    await session.execute(text("""delete from public.editorial_legacy_batch_entries
      where batch_id in (select id from public.editorial_legacy_batches
        where name like 'legacy-worker-%')"""))
    await session.execute(text("""delete from public.editorial_legacy_batches
      where name like 'legacy-worker-%'"""))
    await session.execute(text("""delete from public.concept_revisions r
      using public.concepts c where r.concept_id=c.id
      and c.slug like 'legacy-worker-%'"""))
    await session.execute(text("""delete from public.concepts
      where slug like 'legacy-worker-%'"""))
    await session.execute(text("""delete from public.editorial_memberships
      where invited_email like 'legacy-worker-%@example.invalid'"""))
    await session.commit()


async def seed_batch(session, user):
    await session.execute(text("""update auth.users set email_confirmed_at=now()
      where id=:uid"""), {"uid": user})
    await session.execute(text("""insert into public.editorial_memberships(
      user_id,invited_email,capabilities,requested_name,approved_name)
      values(:uid,:email,array['review','request_generation']::text[],
        'Legacy Reviewer','Legacy Reviewer')"""),
      {"uid": user, "email": f"legacy-worker-{uuid4().hex}@example.invalid"})
    topic, subtopic, subslug = (await session.execute(text("""select c.topic_id,
      c.subtopic_id,s.slug from public.concepts c
      join public.topics t on t.id=c.topic_id and t.is_active
      join public.subtopics s on s.id=c.subtopic_id and s.is_active
      where c.status='published' limit 1"""))).one()
    suffix = uuid4().hex[:10]
    concept = await session.scalar(text("""insert into public.concepts(
      topic_id,subtopic_id,slug,title,summary,example,status)
      values(:tid,:sid,:slug,'Legacy test lesson',
        'The original published summary is intentionally incomplete.',
        'An original short example used by the test.','published')
      returning id"""),
      {"tid": topic, "sid": subtopic, "slug": f"legacy-worker-{suffix}"})
    batch = await session.scalar(text("""insert into public.editorial_legacy_batches(
      topic_id,name,requested_by,model,prompt_version,status,
      discovered_count,quota_limit,started_at)
      values(:tid,:name,:uid,'gemini-3.1-flash-lite',
        'legacy-complete-card-v5-publication-bounds','running',1,2,now())
      returning id"""),
      {"tid": topic, "name": f"legacy-worker-{suffix}", "uid": user})
    source = {"title": "Legacy test lesson",
              "summary": "The original published summary is incomplete.",
              "example": "An original short example.",
              "curriculum": {"prerequisites": []},
              "flashcard": {}, "mcqs": [], "subtopic_slug": subslug}
    entry = await session.scalar(text("""insert into
      public.editorial_legacy_batch_entries(
        batch_id,concept_id,base_version,source_body)
      values(:bid,:cid,1,cast(:body as jsonb)) returning id"""),
      {"bid": batch, "cid": concept, "body": json.dumps(source)})
    await session.commit()
    return batch, entry, concept, subslug


CLAIM = text("select public.edge_worker_claim_legacy_enrichment(200,20,250)")


@pytest.mark.asyncio
async def test_legacy_worker_stages_complete_grounded_private_draft(session, user):
    _, entry, concept, subslug = await seed_batch(session, user)
    assert await session.scalar(text(
      "select public.edge_worker_claim_legacy_enrichment(0,20,250)")) is None
    claimed = decoded(await session.scalar(CLAIM))
    assert claimed["id"] == str(entry)
    assert claimed["model"] == "gemini-3.1-flash-lite"
    await session.commit()
    body = {"title": "Legacy test lesson",
            "summary": "A transaction groups related changes into one unit. "
            "If any change fails, all can roll back, leaving the records "
            "consistent for the next request.",
            "example": "A store records payment and stock together. "
            "If payment fails, the item remains in stock.",
            "subtopic_slug": subslug,
            "curriculum": {"objective": "Explain atomicity with a concrete example",
                           "difficulty": 2, "prerequisites": [],
                           "references": [{"title": "PostgreSQL documentation",
                             "url": "https://www.postgresql.org/docs/current/tutorial-transactions.html"}]},
            "learning_package": {"flashcard": {
              "front": "What does a transaction protect?",
              "back": "It keeps related changes together."},
              "mcqs": [{"question": f"Which change belongs in example {i}?",
                        "options": ["Payment", "Weather", "Traffic", "Nothing"],
                        "correct_index": 0} for i in range(3)]},
            "model": "gemini-3.1-flash-lite",
            "prompt_version": "legacy-complete-card-v5-publication-bounds"}
    finish = text("""select public.edge_worker_finish_legacy_enrichment(
      :id,:token,true,null,cast(:body as jsonb))""")
    args = {"id": entry, "token": claimed["claim_token"],
            "body": json.dumps(body)}
    assert await session.scalar(finish, args) == "ready_for_review"
    assert await session.scalar(finish, args) == "superseded"
    await session.commit()
    row = (await session.execute(text("""select e.status,b.status as batch_status,
      r.status as revision_status,r.body->'curriculum'->'references' as refs
      from public.editorial_legacy_batch_entries e
      join public.editorial_legacy_batches b on b.id=e.batch_id
      join public.concept_revisions r on r.id=e.result_revision_id
      where e.id=:id"""), {"id": entry})).one()
    assert row.status == "ready_for_review"
    assert row.batch_status == "completed"
    assert row.revision_status == "draft"
    assert decoded(row.refs)[0]["url"].startswith("https://")
    assert await session.scalar(text("""select status from public.concepts
      where id=:cid"""), {"cid": concept}) == "published"
    await session.commit()


@pytest.mark.asyncio
async def test_legacy_worker_blocks_when_requester_revoked(session, user):
    _, entry, _, _ = await seed_batch(session, user)
    claimed = decoded(await session.scalar(CLAIM))
    await session.execute(text("""update public.editorial_memberships
      set status='revoked' where user_id=:uid"""), {"uid": user})
    await session.commit()
    assert await session.scalar(text("""select
      public.edge_worker_finish_legacy_enrichment(
      :id,:token,true,'provider_error',null)"""),
      {"id": entry, "token": claimed["claim_token"]}) == "skipped"
