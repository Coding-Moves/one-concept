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
