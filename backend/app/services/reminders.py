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
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
BATCH_SIZE = 100

TITLE = "One Concept"
BODY = "Today's concept is waiting. A minute now keeps the streak alive."

# Claim every due (user, slot) in a single statement. The window matches the
# worker's cron cadence: a slot fires once, in the run that first sees it.
#
# The comparison happens on full timestamps, never bare times: time-of-day
# arithmetic wraps modulo 24h, which made every slot within `window` minutes
# after local midnight an empty range (issue #32). Each slot is considered as
# two occurrences — today's and yesterday's — so a 23:58 slot caught by the
# 00:05 run is still delivered, and is logged and completion-checked against
# the day it was scheduled for.
#
# The INSERT .. SELECT claims all due slots at once and RETURNS the ones this
# run actually won: `on conflict do nothing` both silences an already-sent slot
# and settles the race with an overlapping worker, so a separate not-exists
# check and the old per-row INSERT loop are both unnecessary (issue #41).
_CLAIM_DUE = text("""
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
    ),
    due as (
        select distinct o.user_id, o.local_date, o.slot
          from occurrences o
         where o.slot_at <= o.local_now
           and o.slot_at > o.local_now - make_interval(mins => :window)
           -- Only bother claiming for users with a handset to push to.
           and exists (
               select 1 from public.device_tokens dt where dt.user_id = o.user_id)
           and not exists (
               select 1 from public.daily_assignments da
                where da.user_id = o.user_id
                  and da.assigned_for = o.local_date
                  and da.completed_at is not null)
           and not exists (
               -- A finished CURRENT day also silences yesterday's late slot: the
               -- push says "today's concept is waiting", and past midnight the
               -- only lesson it can lead to is today's.
               select 1 from public.daily_assignments da
                where da.user_id = o.user_id
                  and da.assigned_for = o.local_now::date
                  and da.completed_at is not null)
    )
    insert into public.reminder_log (user_id, local_date, slot)
    select user_id, local_date, slot from due
    on conflict do nothing
    returning user_id, local_date, slot
""")

# Tokens for the users we just claimed, so each claimed slot fans out to every
# handset that user has registered.
_TOKENS = text("""
    select user_id, expo_push_token
      from public.device_tokens
     where user_id in :user_ids
""").bindparams(bindparam("user_ids", expanding=True))

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

    # One statement claims every due slot and returns the ones we won.
    claimed = (
        await session.execute(_CLAIM_DUE, {"window": window_minutes, "at": at})
    ).all()
    await session.commit()
    if not claimed:
        return ReminderResult(0, 0)

    # Fan each claimed slot out to every handset the user has registered.
    user_ids = list({row.user_id for row in claimed})
    tokens_by_user: dict = {}
    for tok in (await session.execute(_TOKENS, {"user_ids": user_ids})).all():
        tokens_by_user.setdefault(tok.user_id, []).append(tok.expo_push_token)

    messages: list[dict] = [
        {
            "to": token,
            "title": TITLE,
            "body": BODY,
            # Sound + heads-up banner, matching what people expect of a nudge.
            "sound": "default",
            "priority": "high",
            "channelId": "reminders",
        }
        for row in claimed
        for token in tokens_by_user.get(row.user_id, [])
    ]

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
