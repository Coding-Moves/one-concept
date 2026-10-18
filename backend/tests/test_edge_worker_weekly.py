"""Weekly Edge delivery keeps the existing quiz snapshot and receipt outbox."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

def local_nine_today():
    return datetime.now(timezone.utc).replace(hour=9, minute=5, second=0, microsecond=0)


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


async def make_eligible(session, user):
    concepts = (await session.execute(text("""select id from public.concepts
      where status='published' order by id limit 7"""))).scalars().all()
    assert len(concepts) == 7
    for index, concept in enumerate(concepts):
        questions = [{"question": f"Reviewed question {index}-{part}?",
                      "options": ["One", "Two", "Three", "Four"],
                      "correct_index": 0} for part in range(3)]
        await session.execute(text("update public.concepts set mcqs=cast(:q as jsonb) where id=:id"),
                              {"q": json.dumps(questions), "id": concept})
        await session.execute(text("""insert into public.daily_assignments(
          user_id,concept_id,assigned_for,completed_at)
          values (:uid,:concept,date '2025-01-01'+cast(:offset as integer),now())"""),
          {"uid": user, "concept": concept, "offset": index})
    await session.commit()


@pytest.mark.asyncio
async def test_weekly_enqueue_send_and_receipt_are_separate(session, user):
    await make_eligible(session, user)
    token = "ExponentPushToken[edge-weekly-one]"
    await session.execute(text("""update public.notification_preferences
      set weekly_quiz_enabled=true where user_id=:uid"""), {"uid": user})
    await session.execute(text("""insert into public.device_tokens(user_id,expo_push_token)
      values (:uid,:token)"""), {"uid": user, "token": token})
    await session.commit()
    at = local_nine_today()
    call = text("select public.edge_worker_enqueue_weekly(:at,15,50)")
    assert await session.scalar(call, {"at": at}) == 1
    await session.commit()
    assert await session.scalar(call, {"at": at}) == 0
    rows = decoded(await session.scalar(text("select public.edge_worker_claim_weekly(:at,100)"),
                                        {"at": at}))
    assert len(rows) == 1 and rows[0]["to"] == token and rows[0]["attempts"] == 1
    await session.commit()
    assert decoded(await session.scalar(text("select public.edge_worker_claim_weekly(:at,100)"),
                                        {"at": at})) == []
    ticket = "test-ticket-001"
    assert await session.scalar(text("""select public.edge_worker_record_weekly(
      cast(:results as jsonb),:at)"""), {"at": at, "results": json.dumps([{
        "id": rows[0]["id"], "status": "accepted", "ticket": ticket,
    }])}) == 1
    await session.commit()
    assert decoded(await session.scalar(text("select public.edge_worker_claim_weekly_receipts(:at,100)"),
                                        {"at": at + timedelta(minutes=14)})) == []
    due = decoded(await session.scalar(text("select public.edge_worker_claim_weekly_receipts(:at,100)"),
                                       {"at": at + timedelta(minutes=16)}))
    assert len(due) == 1 and due[0]["ticket"] == ticket
    assert await session.scalar(text("""select public.edge_worker_record_weekly_receipts(
      cast(:results as jsonb),:at)"""), {"at": at + timedelta(minutes=16),
      "results": json.dumps([{"id": rows[0]["id"], "ticket": ticket, "status": "ok"}])}) == 1
    assert decoded(await session.scalar(text("select public.edge_worker_claim_weekly_receipts(:at,100)"),
                                        {"at": at + timedelta(minutes=60)})) == []
    await session.execute(text("delete from public.device_tokens where user_id=:uid"), {"uid": user})
    await session.commit()


@pytest.mark.asyncio
async def test_interrupted_weekly_send_is_not_replayed(session, user):
    at = local_nine_today()
    week = at.date() - timedelta(days=at.weekday())
    token = "ExponentPushToken[edge-weekly-interrupted]"
    await session.execute(text("""update public.notification_preferences
      set weekly_quiz_enabled=true where user_id=:uid"""), {"uid": user})
    await session.execute(text("insert into public.device_tokens(user_id,expo_push_token) values (:uid,:token)"),
                          {"uid": user, "token": token})
    quiz = await session.scalar(text("""insert into public.weekly_quizzes(
      user_id,week_start,questions,notification_queued_at)
      values (:uid,:week,'[]'::jsonb,:at) returning id"""),
      {"uid": user, "week": week, "at": at})
    await session.execute(text("""insert into public.weekly_quiz_notifications(
      quiz_id,expo_push_token,next_attempt_at,updated_at)
      values (:quiz,:token,:at,:at)"""), {"quiz": quiz, "token": token, "at": at})
    await session.commit()
    rows = decoded(await session.scalar(text("select public.edge_worker_claim_weekly(:at,100)"),
                                        {"at": at}))
    assert len(rows) == 1
    await session.execute(text("""update public.weekly_quiz_notifications
      set updated_at=clock_timestamp()-interval '6 minutes' where id=:id"""),
      {"id": rows[0]["id"]})
    await session.commit()
    assert await session.scalar(text("select public.edge_worker_expire_weekly_sends()")) >= 1
    assert decoded(await session.scalar(text("select public.edge_worker_claim_weekly(:at,100)"),
                                        {"at": at})) == []
    assert await session.scalar(text("select status from public.weekly_quiz_notifications where id=:id"),
                                {"id": rows[0]["id"]}) == "unknown"
    await session.execute(text("delete from public.device_tokens where user_id=:uid"), {"uid": user})
    await session.commit()
