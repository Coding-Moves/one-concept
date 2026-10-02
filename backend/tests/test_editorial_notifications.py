"""Transactional notification evidence in disposable PostgreSQL; no live mail."""

from datetime import timedelta

from sqlalchemy import text
from tests import test_editorial_content_api as content

editorial = content.editorial
api = content.api
draft = content.draft


async def assigned(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    response, _ = await content.act(api, rid, "assign", assignee_id=str(api.owner.id))
    assert response.status_code == 200, response.text
    return rid


async def test_assignment_event_deadline_and_submit_dedup(api, session, draft):
    rid = await assigned(api, session, draft)
    row = (
        (
            await session.execute(
                text("select * from concept_revisions where id=:id"), {"id": rid}
            )
        )
        .mappings()
        .one()
    )
    assert row["review_due_at"] - row["review_assigned_at"] == timedelta(hours=48)
    assert (await content.act(api, rid, "submit"))[0].status_code == 200
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_notification_outbox where revision_id=:id"
            ),
            {"id": rid},
        )
        == 1
    )
    assert (await content.act(api, rid, "approved"))[0].status_code == 200
    new_epoch = await session.scalar(
        text("select notification_epoch from concept_revisions where id=:id"),
        {"id": rid},
    )
    assert new_epoch > row["notification_epoch"]


async def test_outbox_rolls_back_with_assignment(api, session, draft):
    rid = await content.rid_for(session, draft[1])
    await session.execute(
        text("update concept_revisions set assigned_to=:uid where id=:id"),
        {"uid": api.owner.id, "id": rid},
    )
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_notification_outbox where revision_id=:id"
            ),
            {"id": rid},
        )
        == 1
    )
    await session.rollback()
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_notification_outbox where revision_id=:id"
            ),
            {"id": rid},
        )
        == 0
    )


from unittest.mock import AsyncMock
from app.services import editorial_notifications as notices, editorial_mail as mail


async def ready(api, session, draft):
    await session.execute(
        text(
            "truncate editorial_notification_outbox, editorial_email_attempts, editorial_email_batches"
        )
    )
    await session.commit()
    rid = await assigned(api, session, draft)
    settings = api.settings.model_copy(
        update={
            "editorial_email_enabled": True,
            "editorial_email_dashboard_url": "https://review.test.invalid",
            "allowed_origins": "https://review.test.invalid",
            "editorial_gmail_client_id": "fixture-client",
            "editorial_gmail_client_secret": "fixture-secret",
            "editorial_gmail_refresh_token": "fixture-refresh",
            "editorial_email_from": "sender@test.invalid",
            "editorial_email_test_recipients": f"{api.owner.id}@example.invalid",
            "editorial_email_daily_cap": 500,
        }
    )
    await session.execute(
        text(
            "update editorial_notification_outbox set created_at=now()-interval '6 minutes' where revision_id=:id"
        ),
        {"id": rid},
    )
    await session.commit()
    return rid, settings


async def test_delivery_dedup_timezone_and_no_reminder_after_approval(
    api, session, draft
):
    rid, settings = await ready(api, session, draft)
    await session.execute(
        text(
            "update editorial_memberships set notification_timezone='Asia/Karachi' where user_id=:id"
        ),
        {"id": api.owner.id},
    )
    await session.commit()
    sender = AsyncMock()
    await notices.run(session, settings, sender=sender)
    assert sender.await_count == 1
    batch = sender.call_args.args[1]
    assert "PKT" in batch["body"] and "?view=review&kind=revisions&id=" in batch["body"]
    assert "1 assigned lesson(s)" in batch["body"]
    await notices.run(session, settings, sender=sender)
    assert sender.await_count == 1
    await content.act(api, rid, "submit")
    await content.act(api, rid, "approved")
    await session.execute(
        text(
            "update concept_revisions set review_assigned_at=now()-interval '3 days' where id=:id"
        ),
        {"id": rid},
    )
    await session.commit()
    await notices.run(session, settings, sender=sender)
    assert sender.await_count == 1


async def test_retry_uses_frozen_batch_and_bounded_attempts(api, session, draft):
    rid, settings = await ready(api, session, draft)
    sender = AsyncMock(side_effect=mail.DeliveryError("provider_temporary"))
    for _ in range(7):
        await session.execute(
            text(
                "update editorial_email_batches set available_at=now() where recipient_id=:id"
            ),
            {"id": api.owner.id},
        )
        await session.commit()
        await notices.run(session, settings, sender=sender)
    assert sender.await_count == 5
    batches = [call.args[1] for call in sender.call_args_list]
    assert len({str(b["id"]) for b in batches}) == 1
    assert len({b["body"] for b in batches}) == 1
    status = await session.scalar(
        text("select status from editorial_email_batches where id=:id"),
        {"id": batches[0]["id"]},
    )
    assert status == "failed"


async def test_claim_crash_recovery_and_revocation_suppresses(api, session, draft):
    rid, settings = await ready(api, session, draft)
    await notices.prepare(session, settings)
    await session.commit()
    batch = await notices.claim(session, settings)
    assert batch and batch["attempts"] == 1
    await session.execute(
        text(
            "update editorial_email_batches set lease_until=now()-interval '1 minute' where id=:id"
        ),
        {"id": batch["id"]},
    )
    await session.commit()
    recovered = await notices.claim(session, settings)
    assert recovered["id"] == batch["id"] and recovered["attempts"] == 2
    assert await notices.deliver(session, settings, batch, AsyncMock()) == "superseded"
    await session.execute(
        text("update editorial_memberships set status='revoked' where user_id=:id"),
        {"id": api.owner.id},
    )
    await session.commit()
    sender = AsyncMock()
    assert await notices.deliver(session, settings, recovered, sender) == "suppressed"
    sender.assert_not_awaited()


async def test_reminder_cap_coalesces_missed_intervals(api, session, draft):
    rid, settings = await ready(api, session, draft)
    sender = AsyncMock()
    await notices.run(session, settings, sender=sender)
    await session.execute(
        text(
            "update concept_revisions set review_assigned_at=now()-interval '72 hours' where id=:id"
        ),
        {"id": rid},
    )
    await notices.prepare(session, settings)
    await session.execute(
        text(
            "update editorial_notification_outbox set created_at=now()-interval '6 minutes' where revision_id=:id"
        ),
        {"id": rid},
    )
    await session.commit()
    for _ in range(3):
        await notices.run(session, settings, sender=sender)
    assert sender.await_count == 2  # initial + latest due reminder, no catch-up storm
    assert (
        await session.execute(
            text(
                "select ordinal from editorial_notification_outbox where revision_id=:id order by ordinal"
            ),
            {"id": rid},
        )
    ).scalars().all() == [0, 2]


async def test_disabled_allowlist_and_daily_cap_prevent_delivery(api, session, draft):
    rid, settings = await ready(api, session, draft)
    sender = AsyncMock()
    settings.editorial_email_enabled = False
    assert (await notices.run(session, settings, sender=sender))["status"] == "disabled"
    settings.editorial_email_enabled = True
    settings.editorial_email_test_recipients = "someone-else@test.invalid"
    await notices.run(session, settings, sender=sender)
    settings.editorial_email_test_recipients = f"{api.owner.id}@example.invalid"
    settings.editorial_email_daily_cap = 0
    await notices.run(session, settings, sender=sender)
    sender.assert_not_awaited()


async def test_approval_between_claim_and_send_suppresses(api, session, draft):
    rid, settings = await ready(api, session, draft)
    await notices.prepare(session, settings)
    await session.commit()
    # Isolate the batch; other tests retain durable evidence by design.
    batch = await notices.claim(session, settings)
    assert batch["recipient_id"] == api.owner.id
    await content.act(api, rid, "submit")
    await content.act(api, rid, "approved")
    sender = AsyncMock()
    assert await notices.deliver(session, settings, batch, sender) == "suppressed"
    sender.assert_not_awaited()


async def test_setup_blocks_production_until_staging_verified(api, session, draft):
    _, settings = await ready(api, session, draft)
    settings.environment = "production"
    assert mail.setup_status(settings) == "staging_verification_required"
    settings.editorial_email_staging_verified = True
    assert mail.setup_status(settings) == "ready"
    settings.editorial_email_dashboard_url = "https://other.invalid"
    assert mail.setup_status(settings) == "dashboard_setup_required"


async def test_gmail_https_stable_message_id_and_sanitized_errors(monkeypatch):
    from types import SimpleNamespace
    from uuid import uuid4
    import httpx
    import base64
    from email import message_from_bytes

    settings = SimpleNamespace(
        editorial_email_from="sender@test.invalid",
        editorial_email_dashboard_url="https://review.test.invalid",
        editorial_gmail_client_id="client",
        editorial_gmail_client_secret="private-secret",
        editorial_gmail_refresh_token="private-refresh",
    )
    batch = {
        "id": uuid4(),
        "recipient_email": "reviewer@test.invalid",
        "subject": "Review",
        "body": "Sign in to review.",
    }
    requests = []
    status = 200

    async def transport(request):
        requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "private-access"})
        if status == 200:
            return httpx.Response(200, json={"id": "accepted"})
        return httpx.Response(status, json={"error": {"message": "private-response"}})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        mail.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(transport), **kwargs),
    )
    await mail.send(settings, batch)
    await mail.send(settings, batch)
    import json

    ids = [
        message_from_bytes(base64.urlsafe_b64decode(json.loads(r.content)["raw"]))[
            "Message-ID"
        ]
        for r in requests
        if r.url.host == "gmail.googleapis.com"
    ]
    assert len(ids) == 2 and ids[0] == ids[1]
    assert requests[1].headers["Authorization"] == "Bearer private-access"
    status = 429
    try:
        await mail.send(settings, batch)
    except mail.DeliveryError as exc:
        assert str(exc) == "provider_temporary" and exc.retryable
    else:
        raise AssertionError("Expected rate limit")
    status = 403
    try:
        await mail.send(settings, batch)
    except mail.DeliveryError as exc:
        assert str(exc) == "provider_rejected" and not exc.retryable
    else:
        raise AssertionError("Expected authorization failure")


async def test_batching_and_partial_obsolescence_regroups_valid_work(
    api, session, draft
):
    rid, settings = await ready(api, session, draft)
    other = await session.scalar(
        text("""insert into concept_revisions(concept_id,base_version,body,assigned_to)
        select concept_id,base_version,body,assigned_to from concept_revisions where id=:id returning id"""),
        {"id": rid},
    )
    await session.execute(
        text(
            "update editorial_notification_outbox set created_at=now()-interval '6 minutes' where recipient_id=:id"
        ),
        {"id": api.owner.id},
    )
    await notices.prepare(session, settings)
    await session.commit()
    batch = await notices.claim(session, settings)
    assert "2 assigned lesson(s)" in batch["body"]
    # One revision is no longer reviewable when delivery resumes.
    await session.execute(
        text("update concept_revisions set status='rejected' where id=:id"), {"id": rid}
    )
    await session.commit()
    sender = AsyncMock()
    assert await notices.deliver(session, settings, batch, sender) == "suppressed"
    await notices.run(session, settings, sender=sender)
    assert sender.await_count == 1
    body = sender.call_args.args[1]["body"]
    assert (
        str(other) in body and str(rid) not in body and "1 assigned lesson(s)" in body
    )


async def test_crash_after_acceptance_keeps_attempt_and_stable_retry(
    api, session, draft
):
    import pytest

    _, settings = await ready(api, session, draft)
    delivered = []

    async def accepted_then_crashed(config, batch):
        delivered.append(batch["id"])
        raise RuntimeError("simulate process loss before database acknowledgement")

    with pytest.raises(RuntimeError):
        await notices.run(session, settings, sender=accepted_then_crashed)
    row = (
        (
            await session.execute(
                text(
                    "select id,status,attempts from editorial_email_batches where id=:id"
                ),
                {"id": delivered[0]},
            )
        )
        .mappings()
        .one()
    )
    assert row["status"] == "sending" and row["attempts"] == 1
    await session.execute(
        text(
            "update editorial_email_batches set lease_until=now()-interval '1 minute' where id=:id"
        ),
        {"id": row["id"]},
    )
    await session.commit()
    sender = AsyncMock()
    await notices.run(session, settings, sender=sender)
    assert sender.call_args.args[1]["id"] == delivered[0]
    assert sender.call_args.args[1]["attempts"] == 2


async def test_newer_reminder_waits_for_collection_before_coalescing(
    api, session, draft
):
    rid, settings = await ready(api, session, draft)
    await session.execute(
        text(
            "update concept_revisions set review_assigned_at=now()-interval '25 hours' where id=:id"
        ),
        {"id": rid},
    )
    await session.commit()
    sender = AsyncMock()
    # The initial event is old enough, but the newly created reminder is not.
    await notices.run(session, settings, sender=sender)
    sender.assert_not_awaited()
    rows = (
        await session.execute(
            text(
                "select ordinal,suppressed from editorial_notification_outbox where revision_id=:id order by ordinal"
            ),
            {"id": rid},
        )
    ).all()
    assert rows == [(0, False), (1, False)]
    await session.execute(
        text(
            "update editorial_notification_outbox set created_at=now()-interval '6 minutes' where revision_id=:id"
        ),
        {"id": rid},
    )
    await session.commit()
    await notices.run(session, settings, sender=sender)
    await notices.run(session, settings, sender=sender)
    assert sender.await_count == 1
    rows = (
        await session.execute(
            text(
                "select ordinal,suppressed,batch_id is not null from editorial_notification_outbox where revision_id=:id order by ordinal"
            ),
            {"id": rid},
        )
    ).all()
    assert rows == [(0, True, False), (1, False, True)]
