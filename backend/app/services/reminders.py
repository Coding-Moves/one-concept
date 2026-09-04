"""Deciding who gets nudged, and nudging them.

A reminder goes out when three things line up: the user wants reminders, one
of their chosen wall-clock times just passed in *their* timezone, and today's
concept is still unfinished. Completion is the off switch — the moment a user
marks the day learned, every later slot that day stays silent.

The reminder_log claim happens before the push is sent, so a crash or an
overlapping run costs at most a missed nudge, never a double one.
"""

import logging
from dataclasses import dataclass
from datetime import datetime

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
BATCH_SIZE = 100

TITLE = "One Concept"
BODY = "Today's concept is waiting. A minute now keeps the streak alive."

# One row per (user, slot, token) that is due right now. The window matches
# the worker's cron cadence: a slot fires once, in the run that first sees it.
#
# The comparison happens on full timestamps, never bare times: time-of-day
# arithmetic wraps modulo 24h, which made every slot within `window` minutes
# after local midnight an empty range (issue #32). Each slot is considered as
# two occurrences — today's and yesterday's — so a 23:58 slot caught by the
# 00:05 run is still delivered, and is logged and completion-checked against
# the day it was scheduled for.
_DUE = text("""
    with clock as (
        select coalesce(cast(:at as timestamptz), now()) as t
    ),
    candidates as (
        select p.id as user_id,
               (clock.t at time zone p.timezone) as local_now,
               np.reminder_times
          from public.profiles p
          join public.notification_preferences np on np.user_id = p.id
         cross join clock
         where np.enabled
    ),
    occurrences as (
        select c.user_id, c.local_now, s.slot,
               d.day as local_date,
               d.day + s.slot as slot_at
          from candidates c
         cross join lateral unnest(c.reminder_times) as s(slot)
         cross join lateral (values
             (c.local_now::date), (c.local_now::date - 1)) as d(day)
    )
    select o.user_id, o.local_date, o.slot, dt.expo_push_token
      from occurrences o
      join public.device_tokens dt on dt.user_id = o.user_id
     where o.slot_at <= o.local_now
       and o.slot_at > o.local_now - make_interval(mins => :window)
       and not exists (
           select 1 from public.daily_assignments da
            where da.user_id = o.user_id
              and da.assigned_for = o.local_date
              and da.completed_at is not null)
       and not exists (
           select 1 from public.reminder_log rl
            where rl.user_id = o.user_id
              and rl.local_date = o.local_date
              and rl.slot = o.slot)
""")

_CLAIM = text("""
    insert into public.reminder_log (user_id, local_date, slot)
    values (:user_id, :local_date, :slot)
    on conflict do nothing
    returning user_id
""")

_DROP_TOKEN = text("delete from public.device_tokens where expo_push_token = :token")


@dataclass
class ReminderResult:
    sent: int
    dropped_tokens: int


async def _post_batch(client: httpx.AsyncClient, messages: list[dict]) -> list[dict]:
    response = await client.post(EXPO_PUSH_URL, json=messages)
    response.raise_for_status()
    tickets = response.json().get("data", [])
    return tickets if isinstance(tickets, list) else []


async def send_due_reminders(
    session: AsyncSession,
    *,
    window_minutes: int = 15,
    at: datetime | None = None,
) -> ReminderResult:
    """One pass: claim every due (user, slot), then push to their devices."""
    if not 0 < window_minutes < 1440:
        # At a day or more, a slot's today- and yesterday-occurrences both fit
        # the window under different dates and every user is double-pushed.
        raise ValueError("window_minutes must be between 1 and 1439")
    rows = (await session.execute(_DUE, {"window": window_minutes, "at": at})).all()

    # Claim per (user, slot); a user with two devices gets both pushes from
    # the single claim.
    messages: list[dict] = []
    claimed: set[tuple] = set()
    for row in rows:
        key = (row.user_id, row.local_date, row.slot)
        if key not in claimed:
            got = (await session.execute(
                _CLAIM,
                {"user_id": row.user_id, "local_date": row.local_date, "slot": row.slot},
            )).first()
            if got is None:
                continue  # another worker beat us to this slot
            claimed.add(key)
        messages.append({
            "to": row.expo_push_token,
            "title": TITLE,
            "body": BODY,
            # Sound + heads-up banner, matching what people expect of a nudge.
            "sound": "default",
            "priority": "high",
            "channelId": "reminders",
        })
    await session.commit()

    if not messages:
        return ReminderResult(0, 0)

    sent = dropped = 0
    async with httpx.AsyncClient(timeout=30.0) as client:
        for start in range(0, len(messages), BATCH_SIZE):
            batch = messages[start : start + BATCH_SIZE]
            try:
                tickets = await _post_batch(client, batch)
            except httpx.HTTPError as exc:
                log.warning("push batch failed: %s", exc)
                continue
            for message, ticket in zip(batch, tickets):
                if ticket.get("status") == "ok":
                    sent += 1
                elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    # The app was uninstalled; stop sending to this handset.
                    await session.execute(_DROP_TOKEN, {"token": message["to"]})
                    dropped += 1
                else:
                    log.warning("push rejected: %s", ticket)
    await session.commit()

    return ReminderResult(sent, dropped)
