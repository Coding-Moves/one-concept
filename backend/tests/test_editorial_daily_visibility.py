from datetime import timedelta

import pytest
from sqlalchemy import text

from app.services import selection
from app.services.streaks import local_today


@pytest.mark.parametrize("activity", ["assignment", "review"])
async def test_hidden_daily_activity_does_not_create_a_second_activity(
    session, user, activity
):
    today = await local_today(session, user)
    ids = (
        (
            await session.execute(
                text("select id from concepts where status='published' limit 2")
            )
        )
        .scalars()
        .all()
    )
    await session.execute(
        text("""insert into daily_assignments
        (user_id,concept_id,assigned_for,completed_at)
        values (:uid,:cid,:day,now())"""),
        {"uid": user, "cid": ids[0], "day": today - timedelta(days=1)},
    )
    table = "daily_assignments" if activity == "assignment" else "daily_reviews"
    await session.execute(
        text(f"""insert into {table}
        (user_id,concept_id,assigned_for) values (:uid,:cid,:day)"""),
        {"uid": user, "cid": ids[1], "day": today},
    )
    await session.execute(
        text("update concepts set status='archived' where id=:id"), {"id": ids[1]}
    )
    try:
        for allow_review in (False, True, True):
            result = await selection.get_or_create_daily(
                session, user, today=today, allow_review=allow_review
            )
            assert result.status == "exhausted" and result.concept is None
        assert (
            await session.scalar(
                text("""select
            (select count(*) from daily_assignments where user_id=:uid and assigned_for=:day)
            + (select count(*) from daily_reviews where user_id=:uid and assigned_for=:day)"""),
                {"uid": user, "day": today},
            )
            == 1
        )
    finally:
        await session.execute(
            text("update concepts set status='published' where id=:id"), {"id": ids[1]}
        )
        await session.commit()


async def test_retirement_between_selection_and_payload_read_is_safe(
    session, user, monkeypatch
):
    execute = session.execute
    retired = []

    async def retire_after_insert(statement, params=None, **kwargs):
        result = await execute(statement, params, **kwargs)
        if statement is selection._INSERT:
            retired.append(params["cid"])
            # Simulate a catalog retirement becoming visible to the subsequent
            # READ COMMITTED statement, after the daily slot was allocated.
            await execute(
                text("update concepts set status='archived' where id=:id"),
                {"id": params["cid"]},
            )
        return result

    monkeypatch.setattr(session, "execute", retire_after_insert)
    try:
        result = await selection.get_or_create_daily(session, user, allow_review=True)
        assert retired
        assert result.status == "exhausted" and result.concept is None
        assert (
            await session.scalar(
                text("select count(*) from daily_assignments where user_id=:uid"),
                {"uid": user},
            )
            == 1
        )
        assert (
            await session.scalar(
                text("select count(*) from daily_reviews where user_id=:uid"),
                {"uid": user},
            )
            == 0
        )
    finally:
        for cid in retired:
            await execute(
                text("update concepts set status='published' where id=:id"), {"id": cid}
            )
        await session.commit()
