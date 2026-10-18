"""Delivery retry preserves the durable budget, owner gate, and audit event."""

import json
import uuid

import pytest
from sqlalchemy import text

from tests import test_editorial_content_api as content


api = content.api
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_editorial_notification_retry_matches_backend_and_fences_replay(api, session):
    api.settings.__dict__.update({
        "editorial_email_enabled": True,
        "editorial_email_dashboard_url": "https://review.test.invalid",
        "allowed_origins": "https://review.test.invalid",
        "editorial_gmail_client_id": "fixture-client",
        "editorial_gmail_client_secret": "fixture-secret",
        "editorial_gmail_refresh_token": "fixture-refresh",
        "editorial_email_from": "sender@test.invalid",
        "editorial_email_test_recipients": f"{api.owner.id}@example.invalid",
    })
    first, second = uuid.uuid4(), uuid.uuid4()
    for batch in (first, second):
        await session.execute(text("""insert into public.editorial_email_batches
          (id,recipient_id,recipient_email,subject,body,status,attempts)
          values(:id,:uid,'recipient@example.invalid','Private subject','Private body',
            'failed',1)"""), {"id": batch, "uid": api.owner.id})
    await session.commit()
    command = text("""select public.edge_api_editorial_notification_retry(
      :uid,:sid,:aal,:batch,:version,:setup)""")
    args = {"uid": api.owner.id, "sid": api.owner.session_id,
            "aal": "aal2", "batch": first, "version": 1, "setup": "ready"}
    assert _json(await session.scalar(command, args)) == {"status": "pending"}
    await session.commit()
    response = await api.client.post(
        f"{content.ROOT}/notifications/{second}/retry",
        headers=api.headers(), json={"expected_version": 1})
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "pending"}
    assert _json(await session.scalar(command, args))["error"] == "delivery_conflict"
    args["batch"] = uuid.uuid4()
    assert _json(await session.scalar(command, args))["error"] == "delivery_not_found"
    args["batch"] = first
    args["setup"] = "disabled"
    assert _json(await session.scalar(command, args))["error"] == "sender_setup_required"
    args["setup"] = "ready"
    args["aal"] = "aal1"
    assert _json(await session.scalar(command, args))["error"] == "mfa_required"
    args["aal"] = "aal2"
    await session.execute(text("""update public.editorial_memberships
      set capabilities=array['review'] where user_id=:uid"""), args)
    assert _json(await session.scalar(command, args))["error"] == "permission"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_editorial_notification_retry(uuid,uuid,text,uuid,integer,text)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_editorial_notification_retry(uuid,uuid,text,uuid,integer,text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
