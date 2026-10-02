"""Owner delivery operations and reviewer timezone authorization."""

from unittest.mock import AsyncMock
from tests import test_editorial_content_api as content
from tests.test_editorial_notifications import ready
from app.services import editorial_notifications as notices, editorial_mail as mail

editorial = content.editorial
api = content.api
draft = content.draft


async def test_owner_controls_and_reviewer_timezone(api, session):
    from tests.test_editorial_api import enroll, profile_and_approve

    uid, sid, _ = await enroll(api, session, ["review"])
    await profile_and_approve(api, uid, sid)
    headers = api.headers(uid, sid)
    assert (
        await api.client.get("/v1/editorial/notifications", headers=headers)
    ).status_code == 403
    assert (
        await api.client.get(
            "/v1/editorial/notifications", headers=api.headers(aal="aal1")
        )
    ).status_code == 403
    me = (await api.client.get("/v1/editorial/me", headers=headers)).json()
    payload = {"expected_version": me["member"]["version"], "timezone": "Not/AZone"}
    assert (
        await api.client.patch(
            "/v1/editorial/me/notification-timezone", headers=headers, json=payload
        )
    ).status_code == 422
    payload["timezone"] = "Asia/Karachi"
    assert (
        await api.client.patch(
            "/v1/editorial/me/notification-timezone", headers=headers, json=payload
        )
    ).json()["notification_timezone"] == "Asia/Karachi"
    assert (
        await api.client.patch(
            "/v1/editorial/me/notification-timezone", headers=headers, json=payload
        )
    ).status_code == 409
    page = await api.client.get("/v1/editorial/notifications", headers=api.headers())
    assert page.headers["cache-control"] == "no-store"
    policy = page.json()["policy"]
    payload = {
        "expected_version": policy["version"],
        "deadline_hours": 48,
        "reminder_hours": 24,
        "max_reminders": 2,
    }
    assert (
        await api.client.patch(
            "/v1/editorial/notifications/policy", headers=headers, json=payload
        )
    ).status_code == 403
    assert (
        await api.client.patch(
            "/v1/editorial/notifications/policy", headers=api.headers(), json=payload
        )
    ).status_code == 200
    assert (
        await api.client.patch(
            "/v1/editorial/notifications/policy", headers=api.headers(), json=payload
        )
    ).status_code == 409


async def test_owner_retry_preserves_budget_and_revalidates(api, session, draft):
    rid, settings = await ready(api, session, draft)
    api.settings.__dict__.update(settings.__dict__)
    sender = AsyncMock(side_effect=mail.DeliveryError("sender_authentication", False))
    await notices.run(session, settings, sender=sender)
    batch = sender.call_args.args[1]
    path = f"/v1/editorial/notifications/{batch['id']}/retry"
    response = await api.client.post(
        path, headers=api.headers(), json={"expected_version": 1}
    )
    assert response.status_code == 200, response.text
    assert (
        await api.client.post(path, headers=api.headers(), json={"expected_version": 1})
    ).status_code == 409
    await content.act(api, rid, "assign", assignee_id=None, review_due_at=None)
    sender.reset_mock()
    await notices.run(session, settings, sender=sender)
    sender.assert_not_awaited()
