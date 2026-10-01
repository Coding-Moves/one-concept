"""Weekly availability outbox. Never resend after an ambiguous push outcome.

Quiz identity stays in the existing ISO week; the send window is local 09:00.
Claims are committed before network I/O. Only proven rejection/pre-send failure
may retry, up to three attempts, during local daytime in the same quiz week.
"""

import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import text

from app.services.reminders import EXPO_PUSH_URL, ReminderResult
from app.services.weekly_quizzes import get_or_create_weekly_quiz, _week_start

log = logging.getLogger(__name__)
RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
LIMIT = 100

# Rechecked under the profile lock before freezing/queuing a quiz.
_DUE = """
 select p.id from profiles p join notification_preferences n on n.user_id=p.id
 where n.enabled and n.weekly_quiz_enabled
 and (:at at time zone p.timezone)::time >= time '09:00'
 and (:at at time zone p.timezone)::time < time '09:00' + make_interval(mins => :window)
 and exists(select 1 from device_tokens d where d.user_id=p.id)
 and (exists(select 1 from weekly_quizzes q where q.user_id=p.id and q.week_start=:week)
   or (select count(*) from (select c.id from daily_assignments a join concepts c on c.id=a.concept_id
       where a.user_id=p.id and a.completed_at is not null and c.status='published'
       and case when jsonb_typeof(c.mcqs)='array' then jsonb_array_length(c.mcqs)=3 else false end
       group by c.id limit 7) available) = 7)
 and not exists(select 1 from weekly_quizzes q where q.user_id=p.id
   and q.week_start=:week and (q.notification_queued_at is not null or exists(
     select 1 from weekly_quiz_attempts a where a.quiz_id=q.id)))
"""
_VALID = """
 q.week_start=:week and n.enabled and n.weekly_quiz_enabled
 and not exists(select 1 from weekly_quiz_attempts a where a.quiz_id=q.id)
 and exists(select 1 from device_tokens d where d.user_id=q.user_id
   and d.expo_push_token=w.expo_push_token)
"""


async def enqueue_due(session, at, window):
    week = _week_start(at.date())
    params = {"at": at, "window": window, "week": week}
    # A bounded run; later cron runs handle additional users. Never generate AI.
    users = (
        (
            await session.execute(
                text(_DUE + " order by p.id limit :limit"), {**params, "limit": LIMIT}
            )
        )
        .scalars()
        .all()
    )
    await session.commit()
    for uid in users:
        await session.execute(
            text("select id from profiles where id=:uid for update"), {"uid": uid}
        )
        due = await session.scalar(
            text(_DUE + " and p.id=:uid"), {**params, "uid": uid}
        )
        if due:
            quiz = await get_or_create_weekly_quiz(session, uid, today=at.date())
            if quiz.available:
                queued = await session.scalar(
                    text("""update weekly_quizzes set notification_queued_at=:at
                    where id=:id and notification_queued_at is null returning id"""),
                    {"id": quiz.quiz_id, "at": at},
                )
                if queued:
                    await session.execute(
                        text("""insert into weekly_quiz_notifications(quiz_id,expo_push_token,next_attempt_at,updated_at)
                        select :qid,expo_push_token,:at,:at from device_tokens where user_id=:uid
                        on conflict do nothing"""),
                        {"qid": queued, "uid": uid, "at": at},
                    )
        await session.commit()


async def claim_due(session, at):
    params = {"at": at, "week": _week_start(at.date()), "limit": LIMIT}
    # Disabled preferences/completion/account changes permanently silence pending work.
    await session.execute(
        text(
            """update weekly_quiz_notifications w set status='skipped',updated_at=:at
        from weekly_quizzes q join notification_preferences n on n.user_id=q.user_id
        where w.quiz_id=q.id and w.status in ('pending','retry') and not ("""
            + _VALID
            + ")"
        ),
        params,
    )
    rows = (
        await session.execute(
            text(
                """with due as (
        select w.id from weekly_quiz_notifications w
        join weekly_quizzes q on q.id=w.quiz_id
        join profiles p on p.id=q.user_id
        join notification_preferences n on n.user_id=q.user_id
        where w.status in ('pending','retry') and w.attempts<3 and w.next_attempt_at<=:at
        and """
                + _VALID
                + """
        and (:at at time zone p.timezone)::time >= time '09:00'
        and (:at at time zone p.timezone)::time < time '20:00'
        order by w.next_attempt_at,w.id limit :limit for update of w skip locked
        ) update weekly_quiz_notifications w set status='sending',attempts=attempts+1,updated_at=:at
        from due where w.id=due.id returning w.id,w.quiz_id,w.expo_push_token,w.attempts
        """
            ),
            params,
        )
    ).all()
    await session.commit()
    return rows


async def record(
    session, row, state, at, ticket=None, *, expected="sending", expected_ticket=None
):
    if state == "retry" and row.attempts >= 3:
        state = "failed"
    delay = timedelta(minutes=15 * 2 ** max(0, row.attempts - 1))
    await session.execute(
        text("""update weekly_quiz_notifications set status=:state,
        ticket_id=:ticket,next_attempt_at=:next,updated_at=:at where id=:id and status=:expected
        and (cast(:expected_ticket as text) is null or ticket_id=:expected_ticket)"""),
        {
            "state": state,
            "ticket": ticket,
            "next": at + delay,
            "at": at,
            "id": row.id,
            "expected": expected,
            "expected_ticket": expected_ticket,
        },
    )


async def drop_token(session, row):
    # A token can move accounts while a provider response is in flight.
    await session.execute(
        text("""delete from device_tokens d using weekly_quizzes q
        where q.id=:qid and d.user_id=q.user_id and d.expo_push_token=:token"""),
        {"qid": row.quiz_id, "token": row.expo_push_token},
    )


async def check_receipts(session, client, at):
    rows = (
        await session.execute(
            text("""select id,quiz_id,expo_push_token,attempts,ticket_id,updated_at
        from weekly_quiz_notifications where status='accepted' and ticket_id is not null
        and next_attempt_at<=:at order by next_attempt_at,id limit :limit"""),
            {"at": at, "limit": LIMIT},
        )
    ).all()
    await session.commit()
    if not rows:
        return 0
    try:
        response = await client.post(
            RECEIPTS_URL, json={"ids": [r.ticket_id for r in rows]}
        )
        response.raise_for_status()
        body = response.json()
        receipts = body.get("data", {}) if isinstance(body, dict) else {}
        if not isinstance(receipts, dict):
            receipts = {}
    except (httpx.HTTPError, ValueError):
        log.warning("Weekly quiz receipt lookup failed; delivery will not be replayed")
        receipts = {}  # Back off lookups; expire unresolved receipts after 24 hours.
    dropped = 0
    for row in rows:
        receipt = receipts.get(row.ticket_id)
        if isinstance(receipt, dict) and receipt.get("status") == "error":
            details = receipt.get("details")
            error = details.get("error") if isinstance(details, dict) else None
            if error == "DeviceNotRegistered":
                await drop_token(session, row)
                dropped += 1
            await record(
                session,
                row,
                "retry" if error == "MessageRateExceeded" else "failed",
                at,
                expected="accepted",
                expected_ticket=row.ticket_id,
            )
        elif isinstance(receipt, dict) and receipt.get("status") == "ok":
            # Accepted by the platform, not proof of display on the handset.
            await session.execute(
                text(
                    "update weekly_quiz_notifications set next_attempt_at='infinity' where id=:id and status='accepted' and ticket_id=:ticket"
                ),
                {"id": row.id, "ticket": row.ticket_id},
            )
        elif at - row.updated_at > timedelta(hours=24):
            await record(
                session,
                row,
                "unknown",
                at,
                expected="accepted",
                expected_ticket=row.ticket_id,
            )
        else:
            await session.execute(
                text(
                    "update weekly_quiz_notifications set next_attempt_at=:next where id=:id and status='accepted' and ticket_id=:ticket"
                ),
                {
                    "next": at + timedelta(minutes=15),
                    "id": row.id,
                    "ticket": row.ticket_id,
                },
            )
    await session.commit()
    return dropped


async def send_weekly_quiz_notifications(session, *, at=None, window_minutes=15):
    if not 0 < window_minutes <= 60:
        raise ValueError("window_minutes must be between 1 and 60")
    at = at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        raise ValueError("at must include a timezone")
    at = at.astimezone(timezone.utc)
    await enqueue_due(session, at, window_minutes)
    sent = dropped = 0
    async with httpx.AsyncClient(timeout=30.0) as client:
        dropped += await check_receipts(session, client, at)
        rows = await claim_due(session, at)
        if not rows:
            return ReminderResult(0, dropped)
        messages = [
            {
                "to": r.expo_push_token,
                "title": "Your weekly quiz is ready",
                "body": "Seven questions from concepts you learned. Take it when you like.",
                "sound": "default",
                "channelId": "reminders",
                "ttl": 3600,
                "data": {"type": "weekly_quiz", "quiz_id": str(r.quiz_id)},
            }
            for r in rows
        ]
        try:
            response = await client.post(EXPO_PUSH_URL, json=messages)
            if response.status_code == 429:
                tickets = [
                    {"status": "error", "details": {"error": "MessageRateExceeded"}}
                    for _ in rows
                ]
            else:
                response.raise_for_status()
                body = response.json()
                tickets = body.get("data", []) if isinstance(body, dict) else []
                if not isinstance(tickets, list) or len(tickets) != len(rows):
                    tickets = []  # Cannot safely correlate an incomplete provider response.
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            tickets = [
                {"status": "error", "details": {"error": "MessageRateExceeded"}}
                for _ in rows
            ]
        except (httpx.HTTPError, ValueError):
            # Read/write timeout, 5xx, malformed reply: acceptance is uncertain.
            tickets = []
            log.warning("Weekly quiz push outcome unknown; automatic resend suppressed")
        for index, row in enumerate(rows):
            ticket = (
                tickets[index]
                if index < len(tickets) and isinstance(tickets[index], dict)
                else {}
            )
            if ticket.get("status") == "ok":
                await record(session, row, "accepted", at, ticket.get("id"))
                sent += 1
            elif ticket.get("status") == "error":
                details = ticket.get("details")
                error = details.get("error") if isinstance(details, dict) else None
                if error == "DeviceNotRegistered":
                    await drop_token(session, row)
                    dropped += 1
                await record(
                    session,
                    row,
                    "retry" if error == "MessageRateExceeded" else "failed",
                    at,
                )
            else:
                await record(session, row, "unknown", at)
        await session.commit()
    return ReminderResult(sent, dropped)
