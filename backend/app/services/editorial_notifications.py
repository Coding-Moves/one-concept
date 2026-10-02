"""Private transactional outbox, bounded at-least-once Gmail delivery.

All writers use account -> catalog -> notification lock order. Claims commit
before I/O; a killed process leaves a durable attempt and a recoverable lease.
The final eligibility check and Gmail acceptance hold the same account/catalog
locks as review transitions, so a queued approval/revocation wins before send
or waits for an already-started delivery. Email can arrive later in either case.
"""

from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from app.services import editorial_mail as mail
from app.services.editorial_accounts import lock_accounts
from app.services.curriculum import catalog_lock

# Require CURRENT content/taxonomy and CURRENT confirmed editorial authority.
ELIGIBLE = """
 from editorial_notification_outbox o
 join concept_revisions r on r.id=o.revision_id
 join concepts c on c.id=r.concept_id
 join topics t on t.id=c.topic_id
 join subtopics s on s.id=c.subtopic_id
 join editorial_memberships m on m.user_id=o.recipient_id
 join auth.users u on u.id=m.user_id
 where not o.suppressed and r.assigned_to=o.recipient_id
 and r.notification_epoch=o.epoch and r.status in ('draft','pending_review')
 and r.base_version=c.content_version and c.status<>'archived'
 and t.is_active and s.is_active and m.status='active'
 and m.approved_name is not null and 'review'=any(m.capabilities)
 and u.email_confirmed_at is not null
 and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and lower(u.email)=lower(m.invited_email)
"""


async def locks(db):
    await lock_accounts(db)
    await catalog_lock(db)
    await db.execute(text("select pg_advisory_xact_lock(279,263)"))


async def policy(db):
    return dict(
        (await db.execute(text("select * from editorial_notification_policy")))
        .mappings()
        .one()
    )


async def prepare(db, settings):
    """One bounded batch per recipient per tick. Nothing commits outside caller."""
    await locks(db)
    await db.execute(
        text("""insert into editorial_notification_outbox
        (revision_id,recipient_id,epoch,ordinal)
        select r.id,r.assigned_to,r.notification_epoch,
          least(p.max_reminders,floor(extract(epoch from (now()-r.review_assigned_at))/3600/p.reminder_hours)::int)
        from concept_revisions r cross join editorial_notification_policy p
        where r.assigned_to is not null and r.status in ('draft','pending_review')
          and p.max_reminders>0 and r.review_assigned_at <= now()-make_interval(hours=>p.reminder_hours)
        on conflict do nothing""")
    )
    # Keep stale records for diagnostics without permitting future delivery.
    await db.execute(
        text(
            """update editorial_notification_outbox set suppressed=true
        where not suppressed and batch_id is null and id not in (select o.id"""
            + ELIGIBLE
            + ")"
        )
    )
    rows = (
        (
            await db.execute(
                text(
                    """select o.id,o.revision_id,o.ordinal,o.recipient_id,
        u.email,m.notification_timezone,r.review_due_at,t.name as topic_name
        """
                    + ELIGIBLE
                    + """ and o.batch_id is null and o.created_at <= now()-interval '5 minutes'
        and (:production or lower(u.email)=any(:recipients))
        order by o.recipient_id,o.revision_id,o.ordinal desc limit 250"""
                ),
                {
                    "production": settings.is_production,
                    "recipients": list(mail.test_recipients(settings)),
                },
            )
        )
        .mappings()
        .all()
    )
    grouped = {}
    for row in rows:
        if not settings.is_production and row[
            "email"
        ].lower() not in mail.test_recipients(settings):
            continue
        grouped.setdefault(row["recipient_id"], []).append(row)
    for uid, items in list(grouped.items())[:10]:
        # Collapse missed reminders and initial notices for the same revision.
        newest = {}
        for item in items:
            newest.setdefault(item["revision_id"], item)
        selected = list(newest.values())[:25]
        recipient = selected[0]
        try:
            tz = ZoneInfo(recipient["notification_timezone"])
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("UTC")
        body = [f"You have {len(selected)} assigned lesson(s) ready for review.", ""]
        for item in selected:
            due = (
                item["review_due_at"].astimezone(tz).strftime("%Y-%m-%d %H:%M %Z")
                if item["review_due_at"]
                else "No deadline"
            )
            url = f"{settings.editorial_email_dashboard_url.rstrip('/')}/?view=review&kind=revisions&id={item['revision_id']}"
            body.extend([f"Topic: {item['topic_name']} | Due: {due}", url, ""])
        body.append(
            "Sign in with your invited account and authenticator. Review and approval happen only in the workspace."
        )
        bid = uuid4()
        await db.execute(
            text("""insert into editorial_email_batches
            (id,recipient_id,recipient_email,subject,body) values(:id,:uid,:email,:subject,:body)"""),
            {
                "id": bid,
                "uid": uid,
                "email": recipient["email"],
                "subject": "One Concept: assigned lessons to review",
                "body": "\n".join(body),
            },
        )
        ids = [item["id"] for item in selected]
        await db.execute(
            text(
                "update editorial_notification_outbox set batch_id=:bid where id=any(:ids)"
            ),
            {"bid": bid, "ids": ids},
        )
        await db.execute(
            text("""update editorial_notification_outbox set suppressed=true
            where batch_id is null and revision_id=any(:rids) and id<>all(:ids)"""),
            {"rids": [item["revision_id"] for item in selected], "ids": ids},
        )


async def claim(db, settings):
    await locks(db)
    # A crashed fifth attempt is terminal, never silently left in "sending".
    await db.execute(
        text("""update editorial_email_batches set status='failed',failure_code='attempts_exhausted'
        where status='sending' and lease_until<now() and attempts>=5""")
    )
    used = await db.scalar(
        text(
            "select count(*) from editorial_email_attempts where started_at>now()-interval '24 hours'"
        )
    )
    if used >= settings.editorial_email_daily_cap:
        await db.commit()
        return None
    row = (
        (
            await db.execute(
                text("""select * from editorial_email_batches
        where attempts<5 and ((status='pending' and available_at<=now())
           or (status='sending' and lease_until<now()))
        order by available_at,id limit 1 for update""")
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        await db.commit()
        return None
    token = uuid4()
    await db.execute(
        text("""update editorial_email_batches set status='sending',attempts=attempts+1,
        claim_token=:token,lease_until=now()+interval '10 minutes' where id=:id"""),
        {"token": token, "id": row["id"]},
    )
    await db.execute(
        text(
            "insert into editorial_email_attempts(batch_id,attempt) values(:id,:attempt)"
        ),
        {"id": row["id"], "attempt": row["attempts"] + 1},
    )
    await db.commit()
    return dict(row) | {"claim_token": token, "attempts": row["attempts"] + 1}


async def deliver(db, settings, batch, sender):
    await locks(db)
    current = (
        (
            await db.execute(
                text("select * from editorial_email_batches where id=:id for update"),
                {"id": batch["id"]},
            )
        )
        .mappings()
        .one()
    )
    if current["status"] != "sending" or current["claim_token"] != batch["claim_token"]:
        await db.commit()
        return "superseded"
    expected = await db.scalar(
        text("select count(*) from editorial_notification_outbox where batch_id=:id"),
        {"id": batch["id"]},
    )
    valid = await db.scalar(
        text("select count(*)" + ELIGIBLE + " and o.batch_id=:id and u.email=:email"),
        {"id": batch["id"], "email": batch["recipient_email"]},
    )
    allowed = settings.is_production or batch[
        "recipient_email"
    ].lower() in mail.test_recipients(settings)
    if valid != expected or not expected or not allowed:
        # Drop the obsolete snapshot; valid items can be regrouped on next tick.
        # After an unknown Gmail result this can duplicate accepted mail, as with
        # any at-least-once Gmail retry. No stale item is intentionally resent.
        await db.execute(
            text(
                "update editorial_notification_outbox set batch_id=null where batch_id=:id"
            ),
            {"id": batch["id"]},
        )
        state, code = "suppressed", "assignment_or_access_changed"
    elif mail.setup_status(settings) != "ready":
        state, code = "failed", "setup_blocked"
    else:
        try:
            await sender(settings, batch)
            state, code = "sent", None
        except mail.DeliveryError as exc:
            state = "pending" if exc.retryable and batch["attempts"] < 5 else "failed"
            code = exc.code
    await db.execute(
        text("""update editorial_email_batches set status=:state,failure_code=:code,
        sent_at=case when :state='sent' then now() else sent_at end,
        available_at=now()+make_interval(mins=>:delay),lease_until=null,claim_token=null where id=:id"""),
        {
            "state": state,
            "code": code,
            "id": batch["id"],
            "delay": min(360, 15 * 2 ** (batch["attempts"] - 1)),
        },
    )
    await db.commit()
    return state


async def run(db, settings, *, sender=mail.send):
    status = mail.setup_status(settings)
    if status != "ready":
        return {"status": status, "processed": 0}
    await prepare(db, settings)
    await db.commit()
    processed = 0
    for _ in range(10):
        batch = await claim(db, settings)
        if batch is None:
            break
        try:
            await deliver(db, settings, batch, sender)
        except BaseException:
            await db.rollback()  # Durable lease/attempt recover after process failure.
            raise
        processed += 1
    return {"status": "ready", "processed": processed}
