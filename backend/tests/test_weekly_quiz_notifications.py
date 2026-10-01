"""Real PostgreSQL state/concurrency tests; Expo transport is always mocked."""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services import weekly_quiz_notifications as weekly
from app.services.weekly_quizzes import get_or_create_weekly_quiz
from tests import test_reminders
from tests.test_reminders import _register_token

capture_push = test_reminders.capture_push
from tests.test_weekly_quizzes import _make_eligible

AT = datetime(2026, 10, 5, 9, 5, tzinfo=timezone.utc)


@pytest_asyncio.fixture(autouse=True)
async def isolated_push_devices(session):
    # Database fixtures retain users across tests. No test may send to a device
    # left by a previous case; the outbox itself is asserted by owner below.
    await session.execute(text("delete from device_tokens"))
    await session.commit()
    yield
    await session.rollback()
    await session.execute(text("delete from device_tokens"))
    await session.commit()


async def enable(session, user, zone="UTC", token="ExponentPushToken[test-1]"):
    await session.execute(
        text("update profiles set timezone=:zone where id=:uid"),
        {"uid": user, "zone": zone},
    )
    await session.execute(
        text(
            "update notification_preferences set weekly_quiz_enabled=true where user_id=:uid"
        ),
        {"uid": user},
    )
    await session.commit()
    await _register_token(session, user, token)


async def test_one_quiz_notice_per_week_per_device(
    session, sessionmaker_for_test, user, capture_push
):
    sent = capture_push()
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    result = await weekly.send_weekly_quiz_notifications(session, at=AT)
    assert result.sent == 1 and sent[0]["data"]["type"] == "weekly_quiz"
    assert set(sent[0]["data"]) == {"type", "quiz_id"}
    assert (await weekly.send_weekly_quiz_notifications(session, at=AT)).sent == 0
    assert (
        await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(days=1))
    ).sent == 0
    assert (
        await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(days=7))
    ).sent == 1


@pytest.mark.parametrize(
    "zone,at,due",
    [
        ("Asia/Karachi", AT - timedelta(hours=5), True),
        ("Asia/Karachi", AT, False),
        ("Pacific/Kiritimati", AT - timedelta(hours=14), True),
        ("America/New_York", datetime(2026, 11, 1, 14, 5, tzinfo=timezone.utc), True),
        ("America/New_York", datetime(2026, 3, 8, 13, 5, tzinfo=timezone.utc), True),
    ],
)
async def test_local_schedule_and_dst(
    session, sessionmaker_for_test, user, capture_push, zone, at, due
):
    capture_push()
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user, zone)
    assert (await weekly.send_weekly_quiz_notifications(session, at=at)).sent == int(
        due
    )


@pytest.mark.parametrize(
    "reason", ["global_off", "weekly_off", "ineligible", "completed", "no_device"]
)
async def test_suppression(session, sessionmaker_for_test, user, capture_push, reason):
    sent = capture_push()
    await enable(session, user)
    if reason != "ineligible":
        await _make_eligible(sessionmaker_for_test, user)
    if reason in ("global_off", "weekly_off"):
        column = "enabled" if reason == "global_off" else "weekly_quiz_enabled"
        await session.execute(
            text(
                "update notification_preferences set "
                + column
                + "=false where user_id=:uid"
            ),
            {"uid": user},
        )
    elif reason == "completed":
        quiz = await get_or_create_weekly_quiz(session, user, today=AT.date())
        await session.execute(
            text(
                "insert into weekly_quiz_attempts(quiz_id,user_id,answers,correct_count) values(:qid,:uid,'[]',0)"
            ),
            {"qid": quiz.quiz_id, "uid": user},
        )
    elif reason == "no_device":
        await session.execute(
            text("delete from device_tokens where user_id=:uid"), {"uid": user}
        )
    await session.commit()
    assert (await weekly.send_weekly_quiz_notifications(session, at=AT)).sent == 0
    assert not sent


async def test_concurrent_workers_and_crash_claim_do_not_replay(
    session, sessionmaker_for_test, user, capture_push
):
    sent = capture_push()
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)

    async def run():
        async with sessionmaker_for_test() as db:
            return await weekly.send_weekly_quiz_notifications(db, at=AT)

    await asyncio.gather(run(), run())
    assert len(sent) == 1
    # A process dying after its committed claim never retries an unknown send.
    await session.execute(
        text(
            "update weekly_quiz_notifications set status='sending' where quiz_id in (select id from weekly_quizzes where user_id=:uid)"
        ),
        {"uid": user},
    )
    await session.commit()
    await run()
    assert len(sent) == 1


async def test_retry_only_rejected_device_never_successful_peer(
    session, sessionmaker_for_test, user, capture_push
):
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    await _register_token(session, user, "ExponentPushToken[second]")
    sent = capture_push(
        lambda m: (
            {"status": "error", "details": {"error": "MessageRateExceeded"}}
            if m["to"].endswith("second]")
            else {"status": "ok"}
        )
    )
    first = await weekly.send_weekly_quiz_notifications(session, at=AT)
    assert first.sent == 1
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=16))
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=47))
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(hours=2))
    assert sum(m["to"].endswith("test-1]") for m in sent) == 1
    assert sum(m["to"].endswith("second]") for m in sent) == 3
    assert (
        await session.scalar(
            text(
                "select count(*) from weekly_quiz_notifications where status='failed' and quiz_id in (select id from weekly_quizzes where user_id=:uid)"
            ),
            {"uid": user},
        )
        == 1
    )


@pytest.mark.parametrize("after", ["disabled", "completed", "rehomed"])
async def test_retry_rechecks_consent_completion_and_device_owner(
    session, sessionmaker_for_test, user, capture_push, after
):
    import uuid

    sent = capture_push(
        lambda m: {"status": "error", "details": {"error": "MessageRateExceeded"}}
    )
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    await weekly.send_weekly_quiz_notifications(session, at=AT)
    if after == "disabled":
        await session.execute(
            text(
                "update notification_preferences set enabled=false where user_id=:uid"
            ),
            {"uid": user},
        )
    elif after == "completed":
        await session.execute(
            text(
                "insert into weekly_quiz_attempts(quiz_id,user_id,answers,correct_count) select id,user_id,'[]',0 from weekly_quizzes where user_id=:uid"
            ),
            {"uid": user},
        )
    else:
        other = uuid.uuid4()
        await session.execute(
            text(
                "insert into auth.users(id,email) values(:uid,'other@example.invalid')"
            ),
            {"uid": other},
        )
        await session.execute(
            text("update device_tokens set user_id=:uid where user_id=:old"),
            {"uid": other, "old": user},
        )
    await session.commit()
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=16))
    assert len(sent) == 1


@pytest.mark.parametrize(
    "failure,expected",
    [
        ("connect", "retry"),
        ("timeout", "unknown"),
        ("malformed", "unknown"),
        ("server", "unknown"),
    ],
)
async def test_delivery_uncertainty(
    session, sessionmaker_for_test, user, monkeypatch, failure, expected
):
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "connect":
            raise httpx.ConnectError("not sent", request=request)
        if failure == "timeout":
            raise httpx.ReadTimeout("may have sent", request=request)
        return (
            httpx.Response(200, text="not-json")
            if failure == "malformed"
            else httpx.Response(503)
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        weekly.httpx,
        "AsyncClient",
        lambda **kw: original(**kw, transport=httpx.MockTransport(handler)),
    )
    await weekly.send_weekly_quiz_notifications(session, at=AT)
    assert (
        await session.scalar(
            text(
                "select w.status from weekly_quiz_notifications w join weekly_quizzes q on q.id=w.quiz_id where q.user_id=:uid"
            ),
            {"uid": user},
        )
        == expected
    )
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=16))
    assert len(calls) == (2 if expected == "retry" else 1)


async def test_receipts_remove_dead_tokens_without_resending(
    session, sessionmaker_for_test, user, monkeypatch
):
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    sends = []

    def handler(request):
        if request.url.path.endswith("getReceipts"):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "ticket-1": {
                            "status": "error",
                            "details": {"error": "DeviceNotRegistered"},
                        }
                    }
                },
            )
        sends.extend(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "ticket-1"}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        weekly.httpx,
        "AsyncClient",
        lambda **kw: original(**kw, transport=httpx.MockTransport(handler)),
    )
    await weekly.send_weekly_quiz_notifications(session, at=AT)
    result = await weekly.send_weekly_quiz_notifications(
        session, at=AT + timedelta(minutes=16)
    )
    assert result.dropped_tokens == 1 and len(sends) == 1
    assert (
        await session.scalar(
            text("select count(*) from device_tokens where user_id=:uid"), {"uid": user}
        )
        == 0
    )


async def test_outbox_is_backend_only(session):
    await session.execute(text("set local role authenticated"))
    with pytest.raises(DBAPIError):
        await session.execute(text("select * from weekly_quiz_notifications"))
    await session.rollback()


@pytest.mark.parametrize("outcome", ["ok", "missing", "unavailable", "rate_limited"])
async def test_receipt_resolution_and_bounded_retries(
    session, sessionmaker_for_test, user, monkeypatch, outcome
):
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    sends = []
    lookups = []

    def handler(request):
        if request.url.path.endswith("getReceipts"):
            lookups.append(request)
            if outcome == "unavailable":
                return httpx.Response(503)
            receipt = (
                {"status": "ok"}
                if outcome == "ok"
                else {"status": "error", "details": {"error": "MessageRateExceeded"}}
            )
            return httpx.Response(
                200,
                json={"data": {} if outcome == "missing" else {"ticket-1": receipt}},
            )
        sends.append(request)
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "ticket-1"}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        weekly.httpx,
        "AsyncClient",
        lambda **kw: original(**kw, transport=httpx.MockTransport(handler)),
    )
    await weekly.send_weekly_quiz_notifications(session, at=AT)
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=16))
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=17))
    assert len(sends) == 1 and len(lookups) == 1
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(minutes=32))
    assert len(sends) == (2 if outcome == "rate_limited" else 1)
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(hours=25))
    status = await session.scalar(
        text(
            "select w.status from weekly_quiz_notifications w join weekly_quizzes q on q.id=w.quiz_id where q.user_id=:uid"
        ),
        {"uid": user},
    )
    assert status == (
        "unknown"
        if outcome in ("missing", "unavailable")
        else "accepted"
        if outcome == "ok"
        else "retry"
    )


async def test_rate_limit_retry_expires_with_quiz_week(
    session, sessionmaker_for_test, user, capture_push
):
    sent = capture_push(
        lambda m: {"status": "error", "details": {"error": "MessageRateExceeded"}}
    )
    await _make_eligible(sessionmaker_for_test, user)
    await enable(session, user)
    await weekly.send_weekly_quiz_notifications(session, at=AT + timedelta(days=6))
    # At Monday 10:00 the previous quiz cannot send, nor can a new quiz enqueue
    # outside its initial 09:00 window.
    await weekly.send_weekly_quiz_notifications(
        session, at=AT + timedelta(days=7, hours=1)
    )
    assert len(sent) == 1
    assert (
        await session.scalar(
            text(
                "select w.status from weekly_quiz_notifications w join weekly_quizzes q on q.id=w.quiz_id where q.user_id=:uid"
            ),
            {"uid": user},
        )
        == "skipped"
    )


async def test_queue_paginates_all_due_users_before_window_closes(
    session, sessionmaker_for_test, user, monkeypatch
):
    import uuid

    other = uuid.uuid4()
    await session.execute(
        text("insert into auth.users(id,email) values(:uid,:email)"),
        {"uid": other, "email": f"{other}@example.invalid"},
    )
    await session.commit()
    for uid in (user, other):
        await _make_eligible(sessionmaker_for_test, uid)
        await enable(session, uid, token=f"ExponentPushToken[{uid}]")
    monkeypatch.setattr(weekly, "LIMIT", 1)
    await weekly.enqueue_due(session, AT, 15)
    count = await session.scalar(
        text("""select count(distinct q.user_id)
        from weekly_quiz_notifications w join weekly_quizzes q on q.id=w.quiz_id
        where q.user_id in (:first,:second)"""),
        {"first": user, "second": other},
    )
    assert count == 2, (
        "The SQL page size must not postpone eligible users to another day"
    )
    await weekly.enqueue_due(session, AT, 15)
    assert (
        await session.scalar(
            text("""select count(*) from weekly_quiz_notifications w
        join weekly_quizzes q on q.id=w.quiz_id where q.user_id in (:first,:second)"""),
            {"first": user, "second": other},
        )
        == 2
    )
