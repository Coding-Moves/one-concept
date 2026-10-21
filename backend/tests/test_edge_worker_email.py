"""Editorial mail claims preserve recipient access and the rolling send cap."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.fixture(autouse=True)
async def isolate_mail_queue(session):
    # This global worker claims the oldest batch. Earlier editorial tests may
    # have left other pending recipients in the disposable integration DB.
    async def clear():
        await session.execute(text("delete from public.editorial_email_attempts"))
        await session.execute(text("delete from public.editorial_notification_outbox"))
        await session.execute(text("delete from public.editorial_email_batches"))
        await session.commit()
    await clear()
    yield
    await session.rollback()
    await clear()


async def assigned_revision(session, user):
    email = f"{user}@example.invalid"
    await session.execute(text("""update auth.users set email_confirmed_at=now()
      where id=:uid"""), {"uid": user})
    await session.execute(text("""insert into public.editorial_memberships(
      user_id,invited_email,capabilities,requested_name,approved_name)
      values (:uid,:email,array['review']::text[],'Test Reviewer','Test Reviewer')"""),
      {"uid": user, "email": email})
    topic = await session.scalar(text("""select c.topic_id from public.concepts c
      join public.topics t on t.id=c.topic_id and t.is_active
      join public.subtopics s on s.id=c.subtopic_id and s.is_active
      where c.status='published' limit 1"""))
    concept = await session.scalar(text("""insert into public.concepts(
      topic_id,slug,title,summary,status) values
      (:tid,:slug,'Email worker test','A test concept','published') returning id"""),
      {"tid": topic, "slug": f"email-worker-{uuid4()}"})
    revision = await session.scalar(text("""insert into public.concept_revisions(
      concept_id,base_version,body,status,assigned_to)
      values (:cid,1,'{}'::jsonb,'draft',:uid) returning id"""),
      {"cid": concept, "uid": user})
    await session.execute(text("""update public.editorial_notification_outbox
      set created_at=now()-interval '6 minutes' where revision_id=:rid"""),
      {"rid": revision})
    await session.commit()
    return email, revision


@pytest.mark.asyncio
async def test_prepare_claim_and_revocation_guard(session, user):
    email, revision = await assigned_revision(session, user)
    prepared = await session.scalar(text("""select public.edge_worker_prepare_email(
      false,:recipients,'https://review.example.test',10)"""),
      {"recipients": [email]})
    assert prepared == 1
    await session.commit()
    assert await session.scalar(text("""select public.edge_worker_prepare_email(
      false,:recipients,'https://review.example.test',10)"""),
      {"recipients": [email]}) == 0
    claim = decoded(await session.scalar(text("select public.edge_worker_claim_email(40)")))
    assert claim["recipient_email"] == email
    assert str(revision) in claim["body"]
    assert claim["attempts"] == 1
    assert await session.scalar(text("select public.edge_worker_email_batch_eligible(:id)"),
                                {"id": claim["id"]}) is True
    await session.commit()
    assert await session.scalar(text("select public.edge_worker_claim_email(40)")) is None
    await session.execute(text("""update public.editorial_memberships
      set status='revoked' where user_id=:uid"""), {"uid": user})
    assert await session.scalar(text("select public.edge_worker_email_batch_eligible(:id)"),
                                {"id": claim["id"]}) is False
    await session.commit()


@pytest.mark.asyncio
async def test_email_cap_and_expired_claim_requires_manual_review(session, user):
    email, _ = await assigned_revision(session, user)
    await session.scalar(text("""select public.edge_worker_prepare_email(
      false,:recipients,'https://review.example.test',10)"""),
      {"recipients": [email]})
    assert await session.scalar(text("select public.edge_worker_claim_email(0)")) is None
    first = decoded(await session.scalar(text("select public.edge_worker_claim_email(500)")))
    assert first["attempts"] == 1
    await session.execute(text("""update public.editorial_email_batches
      set lease_until=now()-interval '1 minute' where id=:id"""),
      {"id": first["id"]})
    await session.commit()
    assert await session.scalar(text("select public.edge_worker_claim_email(500)")) is None
    batch = (await session.execute(text("""select status, failure_code, attempts,
      claim_token, lease_until from public.editorial_email_batches where id=:id"""),
      {"id": first["id"]})).one()
    assert batch == ("failed", "delivery_unknown", 1, None, None)
    await session.commit()
