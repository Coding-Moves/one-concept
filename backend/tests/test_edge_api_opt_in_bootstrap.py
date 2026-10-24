"""Every Edge first-request path keeps a trigger-skipped account opt-in."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text


DAY = date(2026, 10, 15)


@pytest.mark.parametrize("function, params, expected", [
    ("edge_api_daily", "(:uid, 10, 60, 90, :day)", "personalization_required"),
    ("edge_api_achievements", "(:uid)", "items"),
    ("edge_api_weekly_quiz", "(:uid)", "available"),
    ("edge_api_subtopic_quiz", "(:uid, :completion)", "unavailable"),
])
async def test_edge_first_request_does_not_follow_all_topics(session, function, params, expected):
    user_id = uuid.uuid4()
    await session.execute(text("alter table auth.users disable trigger on_auth_user_created"))
    try:
        await session.execute(text("insert into auth.users(id,email) values (:id,:email)"),
                              {"id": user_id, "email": f"{user_id}@example.invalid"})
    finally:
        await session.execute(text("alter table auth.users enable trigger on_auth_user_created"))
    await session.commit()

    assert await session.scalar(text("select count(*) from public.profiles where id=:id"), {"id": user_id}) == 0
    result = await session.scalar(text(f"select public.{function}{params}"),
                                  {"uid": user_id, "day": DAY, "completion": uuid.uuid4()})
    result = json.loads(result) if isinstance(result, str) else result
    if expected == "personalization_required":
        assert result["reason"] == expected
    elif expected == "unavailable":
        assert result["error"] == expected
    elif expected == "available":
        assert result["available"] is False
    else:
        assert isinstance(result[expected], list)

    assert await session.scalar(text("select count(*) from public.profiles where id=:id"), {"id": user_id}) == 1
    assert await session.scalar(text("select count(*) from public.notification_preferences where user_id=:id"), {"id": user_id}) == 1
    assert await session.scalar(text("select count(*) from public.user_topics where user_id=:id"), {"id": user_id}) == 0
