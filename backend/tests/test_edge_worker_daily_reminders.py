"""Daily Edge outbox preserves local due slots and at-most-once delivery."""

import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import text


def utc(day: int, hour: int, minute: int, month: int = 1):
    return datetime(2026, month, day, hour, minute, tzinfo=timezone.utc)


async def token(session, user, value):
    await session.execute(text("""insert into public.device_tokens(user_id,expo_push_token,platform)
      values (:uid,:token,'android')"""), {"uid": user, "token": value})
    await session.commit()


async def enqueue(session, at):
    return await session.scalar(text("select public.edge_worker_enqueue_reminders(:at,15)"),
                                {"at": at})


async def claim(session, at):
    value = await session.scalar(text("select public.edge_worker_claim_reminders(100,:at)"),
                                 {"at": at})
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_due_claim_is_one_use_and_invalid_token_is_removed(session, user):
    await token(session, user, "ExponentPushToken[edge-daily-one]")
    at = utc(15, 8, 5)
    assert await enqueue(session, at) == 1
    await session.commit()
    assert await enqueue(session, at) == 0
    rows = await claim(session, at)
    assert len(rows) == 1 and rows[0]["to"] == "ExponentPushToken[edge-daily-one]"
    await session.commit()  # A provider call happens after the claim commits.
    assert await claim(session, at) == []
    recorded = await session.scalar(text("""select public.edge_worker_record_reminders(
      cast(:results as jsonb))"""), {"results": json.dumps([{
        "id": rows[0]["id"], "status": "rejected", "error": "DeviceNotRegistered",
    }])})
    assert recorded == 1
    assert await session.scalar(text("select public.edge_worker_record_reminders('[]'::jsonb)")) == 0
    assert await session.scalar(text("select count(*) from public.device_tokens where user_id=:uid"),
                                {"uid": user}) == 0
    await session.commit()


@pytest.mark.asyncio
async def test_completion_after_enqueue_suppresses_unsent_push(session, user):
    await token(session, user, "ExponentPushToken[edge-daily-complete]")
    at = utc(16, 8, 5)
    assert await enqueue(session, at) == 1
    concept = await session.scalar(text("select id from public.concepts where status='published' limit 1"))
    await session.execute(text("""insert into public.daily_assignments(
      user_id,concept_id,assigned_for,completed_at) values (:uid,:concept,:day,now())"""),
      {"uid": user, "concept": concept, "day": at.date()})
    await session.commit()
    assert await claim(session, at) == []
    assert await session.scalar(text("""select status from public.daily_reminder_outbox
      where user_id=:uid and local_date=:day"""), {"uid": user, "day": at.date()}) == "skipped"
    await session.execute(text("delete from public.device_tokens where user_id=:uid"), {"uid": user})
    await session.commit()


@pytest.mark.asyncio
async def test_midnight_and_dst_occurrences_are_not_replayed(session, user):
    await token(session, user, "ExponentPushToken[edge-daily-dst]")
    await session.execute(text("""update public.notification_preferences
      set reminder_times=ARRAY[time '23:58'] where user_id=:uid"""), {"uid": user})
    await session.commit()
    assert await enqueue(session, utc(16, 0, 5)) == 1
    logged = await session.scalar(text("select local_date from public.reminder_log where user_id=:uid"),
                                  {"uid": user})
    assert str(logged) == "2026-01-15"

    await session.execute(text("update public.profiles set timezone='Europe/Berlin' where id=:uid"),
                          {"uid": user})
    await session.execute(text("""update public.notification_preferences
      set reminder_times=ARRAY[time '02:30'] where user_id=:uid"""), {"uid": user})
    await session.commit()
    assert await enqueue(session, utc(25, 0, 35, month=10)) == 1
    assert await enqueue(session, utc(25, 1, 35, month=10)) == 0
    assert await session.scalar(text("""select count(*) from public.reminder_log
      where user_id=:uid and local_date=date '2026-10-25'"""), {"uid": user}) == 1
    await session.execute(text("delete from public.device_tokens where user_id=:uid"), {"uid": user})
    await session.commit()


@pytest.mark.asyncio
async def test_interrupted_send_becomes_unknown_without_reclaim(session, user):
    await token(session, user, "ExponentPushToken[edge-daily-interrupted]")
    at = utc(17, 8, 5)
    assert await enqueue(session, at) == 1
    rows = await claim(session, at)
    assert len(rows) == 1
    await session.execute(text("""update public.daily_reminder_outbox
      set claimed_at=clock_timestamp()-interval '6 minutes' where id=:id"""),
      {"id": rows[0]["id"]})
    await session.commit()
    assert await session.scalar(text("select public.edge_worker_expire_reminders()")) >= 1
    assert await claim(session, at) == []
    assert await session.scalar(text("select status from public.daily_reminder_outbox where id=:id"),
                                {"id": rows[0]["id"]}) == "unknown"
    await session.execute(text("delete from public.device_tokens where user_id=:uid"), {"uid": user})
    await session.commit()
