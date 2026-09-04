"""Reminders: due-slot selection, timezone handling, dedupe, and stale tokens.

The Expo push endpoint is stubbed; what these tests exercise is the SQL that
decides who is due and the bookkeeping that keeps reminders single-shot.
"""

import json
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import text

from app.services import reminders
from app.services.reminders import send_due_reminders
from app.services.selection import get_or_create_daily
from app.services.interactions import complete_today

# New users default to reminder_times {08:00, 14:00, 20:00} in UTC.
AT_0805 = datetime(2026, 1, 15, 8, 5, tzinfo=timezone.utc)


@pytest.fixture
def capture_push(monkeypatch):
    """Stub the Expo push API; returns the list of sent messages."""
    sent: list[dict] = []

    def use(ticket_for=lambda m: {"status": "ok"}):
        def handler(request: httpx.Request) -> httpx.Response:
            batch = json.loads(request.content)
            sent.extend(batch)
            return httpx.Response(200, json={"data": [ticket_for(m) for m in batch]})

        transport = httpx.MockTransport(handler)
        original = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs["transport"] = transport
            return original(*args, **kwargs)

        monkeypatch.setattr(reminders.httpx, "AsyncClient", factory)
        return sent

    return use


async def _register_token(session, user, token="ExponentPushToken[test-1]"):
    # Same upsert the API uses: a token is unique per handset, and signing in
    # as a different user re-homes it.
    await session.execute(
        text("""insert into public.device_tokens (user_id, expo_push_token, platform)
                values (:u, :t, 'android')
                on conflict (expo_push_token)
                do update set user_id = excluded.user_id, last_seen_at = now()"""),
        {"u": user, "t": token},
    )
    await session.commit()


async def test_due_slot_sends_once_and_only_once(session, user, capture_push):
    sent = capture_push()
    await _register_token(session, user)

    first = await send_due_reminders(session, window_minutes=15, at=AT_0805)
    assert first.sent == 1
    assert sent[0]["to"] == "ExponentPushToken[test-1]"
    assert "concept" in sent[0]["body"]

    again = await send_due_reminders(session, window_minutes=15, at=AT_0805)
    assert again.sent == 0, "the slot was already claimed"

    logged = await session.scalar(
        text("select count(*) from public.reminder_log where user_id = :u"), {"u": user}
    )
    assert logged == 1


async def test_outside_the_window_is_silent(session, user, capture_push):
    capture_push()
    await _register_token(session, user)
    # 08:00 slot, but the clock reads 08:20 — the 15-minute window has passed.
    late = datetime(2026, 1, 15, 8, 20, tzinfo=timezone.utc)
    result = await send_due_reminders(session, window_minutes=15, at=late)
    assert result.sent == 0


async def test_completion_silences_later_slots(session, user, capture_push):
    capture_push()
    await _register_token(session, user)
    day = AT_0805.date()
    await get_or_create_daily(session, user, today=day)
    await complete_today(session, user, day)

    result = await send_due_reminders(session, window_minutes=15, at=AT_0805)
    assert result.sent == 0, "a finished day must stay quiet"


async def test_disabled_preferences_are_respected(session, user, capture_push):
    capture_push()
    await _register_token(session, user)
    await session.execute(
        text("update public.notification_preferences set enabled = false where user_id = :u"),
        {"u": user},
    )
    await session.commit()

    result = await send_due_reminders(session, window_minutes=15, at=AT_0805)
    assert result.sent == 0


async def test_timezone_shifts_the_slot(session, user, capture_push):
    sent = capture_push()
    await _register_token(session, user)
    await session.execute(
        text("update public.profiles set timezone = 'Asia/Karachi' where id = :u"), {"u": user}
    )
    await session.commit()

    # 08:05 UTC is 13:05 in Karachi — no slot there. 03:05 UTC is 08:05 local.
    silent = await send_due_reminders(session, window_minutes=15, at=AT_0805)
    assert silent.sent == 0

    local_morning = datetime(2026, 1, 15, 3, 5, tzinfo=timezone.utc)
    due = await send_due_reminders(session, window_minutes=15, at=local_morning)
    assert due.sent == 1
    assert len(sent) == 1


async def test_dead_tokens_are_dropped(session, user, capture_push):
    capture_push(ticket_for=lambda m: {"status": "error", "details": {"error": "DeviceNotRegistered"}})
    await _register_token(session, user, token="ExponentPushToken[gone]")

    result = await send_due_reminders(session, window_minutes=15, at=AT_0805)
    assert result.sent == 0
    assert result.dropped_tokens == 1

    remaining = await session.scalar(
        text("select count(*) from public.device_tokens where user_id = :u"), {"u": user}
    )
    assert remaining == 0, "an uninstalled handset must stop receiving pushes"


async def test_slot_just_after_midnight_fires(session, user, capture_push):
    """Issue #32: time-of-day arithmetic wrapped at midnight, so a 00:05 slot
    checked at 00:10 fell into an empty range and never fired."""
    sent = capture_push()
    try:
        await _register_token(session, user, token="ExponentPushToken[midnight-1]")
        await session.execute(
            text("update public.notification_preferences set reminder_times = '{00:05}' where user_id = :u"),
            {"u": user},
        )
        await session.commit()

        result = await send_due_reminders(
            session, window_minutes=15, at=datetime(2026, 1, 15, 0, 10, tzinfo=timezone.utc)
        )
        assert result.sent == 1, "a slot five minutes past midnight must fire"
        assert len(sent) == 1

        logged = (await session.execute(
            text("select local_date, slot from public.reminder_log where user_id = :u"), {"u": user}
        )).one()
        assert str(logged.local_date) == "2026-01-15"
    finally:
        # Unconditional: a leaked token would make this user due at the later
        # midnight tests' clocks and cascade one failure into three.
        await session.execute(
            text("delete from public.device_tokens where expo_push_token = 'ExponentPushToken[midnight-1]'"))
        await session.commit()


async def test_slot_before_midnight_caught_by_the_next_run(session, user, capture_push):
    """A 23:58 slot picked up by the 00:05 run belongs to yesterday: it must
    fire once, and be logged against the day it was scheduled for."""
    capture_push()
    try:
        await _register_token(session, user, token="ExponentPushToken[midnight-2]")
        await session.execute(
            text("update public.notification_preferences set reminder_times = '{23:58}' where user_id = :u"),
            {"u": user},
        )
        await session.commit()

        just_past_midnight = datetime(2026, 1, 16, 0, 5, tzinfo=timezone.utc)
        first = await send_due_reminders(session, window_minutes=15, at=just_past_midnight)
        assert first.sent == 1, "yesterday's late slot is still within the window"

        logged = (await session.execute(
            text("select local_date from public.reminder_log where user_id = :u"), {"u": user}
        )).one()
        assert str(logged.local_date) == "2026-01-15", "claimed against the scheduled day, not the new one"

        again = await send_due_reminders(session, window_minutes=15, at=just_past_midnight)
        assert again.sent == 0, "the occurrence fires exactly once"
    finally:
        await session.execute(
            text("delete from public.device_tokens where expo_push_token = 'ExponentPushToken[midnight-2]'"))
        await session.commit()


async def test_completion_on_the_scheduled_day_silences_the_cross_midnight_slot(
    session, user, capture_push
):
    capture_push()
    try:
        await _register_token(session, user, token="ExponentPushToken[midnight-3]")
        await session.execute(
            text("update public.notification_preferences set reminder_times = '{23:58}' where user_id = :u"),
            {"u": user},
        )
        await session.commit()

        scheduled_day = datetime(2026, 1, 15, tzinfo=timezone.utc).date()
        await get_or_create_daily(session, user, today=scheduled_day)
        await complete_today(session, user, scheduled_day)

        result = await send_due_reminders(
            session, window_minutes=15, at=datetime(2026, 1, 16, 0, 5, tzinfo=timezone.utc)
        )
        assert result.sent == 0, "a finished day stays quiet even across midnight"
    finally:
        await session.execute(
            text("delete from public.device_tokens where expo_push_token = 'ExponentPushToken[midnight-3]'"))
        await session.commit()


async def test_completing_the_new_day_silences_yesterdays_late_slot(session, user, capture_push):
    """Finishing today's lesson at 00:02 must stop yesterday's 23:58 nudge at
    00:05 — past midnight, the push could only lead to a lesson already done."""
    capture_push()
    try:
        await _register_token(session, user, token="ExponentPushToken[midnight-4]")
        await session.execute(
            text("update public.notification_preferences set reminder_times = '{23:58}' where user_id = :u"),
            {"u": user},
        )
        await session.commit()

        new_day = datetime(2026, 1, 16, tzinfo=timezone.utc).date()
        await get_or_create_daily(session, user, today=new_day)
        await complete_today(session, user, new_day)

        result = await send_due_reminders(
            session, window_minutes=15, at=datetime(2026, 1, 16, 0, 5, tzinfo=timezone.utc)
        )
        assert result.sent == 0, "a finished current day silences yesterday's late slot"
    finally:
        await session.execute(
            text("delete from public.device_tokens where expo_push_token = 'ExponentPushToken[midnight-4]'"))
        await session.commit()
