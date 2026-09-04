"""Write endpoints: completion, streaks, follows, likes, saves."""

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.services.interactions import complete_today, set_followed_topics, set_interaction
from app.services.selection import get_or_create_daily
from app.services.state import load_state
from app.services.streaks import compute_streaks
from tests.test_selection import DAY


async def _assign_and_complete(session, user, day):
    await get_or_create_daily(session, user, today=day)
    await complete_today(session, user, day)


async def test_completion_is_recorded_and_idempotent(session, user):
    await get_or_create_daily(session, user, today=DAY)
    await complete_today(session, user, DAY)
    await complete_today(session, user, DAY)  # repeating must not error

    rows = await session.scalar(
        text("select count(*) from public.daily_assignments "
             "where user_id = :u and completed_at is not null"),
        {"u": user},
    )
    assert rows == 1


async def test_completing_without_an_assignment_is_rejected(session, user):
    with pytest.raises(HTTPException) as exc:
        await complete_today(session, user, DAY)
    assert exc.value.status_code == 404


async def test_streaks_follow_completion_dates(session, user):
    # A four-day run, a gap, then a three-day run ending on the reference day.
    for offset in (0, 1, 2, 3, 9, 10, 11):
        await _assign_and_complete(session, user, DAY + timedelta(days=offset))

    stats = await compute_streaks(session, user, DAY + timedelta(days=11))
    assert (stats.current, stats.longest, stats.total_learned) == (3, 4, 7)

    # An unfinished today must not break a streak that ran through yesterday.
    tomorrow = await compute_streaks(session, user, DAY + timedelta(days=12))
    assert tomorrow.current == 3

    # A whole day missed does break it.
    later = await compute_streaks(session, user, DAY + timedelta(days=13))
    assert later.current == 0
    assert later.longest == 4


async def test_streaks_never_come_from_the_client(session, user):
    """There is no code path that writes a streak; it is always derived."""
    await _assign_and_complete(session, user, DAY)
    stats = await compute_streaks(session, user, DAY)
    assert stats.current == 1
    columns = await session.scalar(
        text("""select count(*) from information_schema.columns
                 where table_schema = 'public' and column_name ilike '%streak%'""")
    )
    assert columns == 0, "a stored streak column would be a source of drift"


async def test_following_topics_replaces_the_set(session, user):
    kept = await set_followed_topics(session, user, ["mathematics", "computer-science"])
    assert kept == ["computer-science", "mathematics"]

    state = await load_state(session, user)
    assert sorted(state.followed_topics) == ["computer-science", "mathematics"]

    await set_followed_topics(session, user, ["mathematics"])
    state = await load_state(session, user)
    assert state.followed_topics == ["mathematics"]


async def test_unknown_topic_is_rejected(session, user):
    with pytest.raises(HTTPException) as exc:
        await set_followed_topics(session, user, ["mathematics", "underwater-basket-weaving"])
    assert exc.value.status_code == 400


async def test_likes_and_saves_toggle_independently(session, user):
    await set_interaction(session, user, "hash-tables", "liked_at", True)
    await set_interaction(session, user, "hash-tables", "saved_at", True)
    state = await load_state(session, user)
    assert state.likes == ["hash-tables"]
    assert state.bookmarks == ["hash-tables"]

    await set_interaction(session, user, "hash-tables", "liked_at", False)
    state = await load_state(session, user)
    assert state.likes == []
    assert state.bookmarks == ["hash-tables"], "unliking must not unsave"


async def test_interaction_on_unknown_concept_is_rejected(session, user):
    with pytest.raises(HTTPException) as exc:
        await set_interaction(session, user, "not-a-real-concept", "liked_at", True)
    assert exc.value.status_code == 404


async def test_state_aggregates_everything_the_app_needs(session, user):
    await _assign_and_complete(session, user, DAY)
    await set_interaction(session, user, "recursion", "saved_at", True)

    state = await load_state(session, user)
    assert state.timezone == "UTC"
    assert len(state.followed_topics) == 5
    assert len(state.learned) == 1
    assert state.learned[0].learned_on == DAY
    assert state.bookmarks == ["recursion"]
    assert state.stats.total_learned == 1


async def test_bootstrap_creates_everything_when_the_trigger_did_not(session):
    """The safety net must work for a user with no profile at all.

    ensure_bootstrapped runs profile, preferences, and follows in one statement
    for latency, and follows carry a foreign key to profiles — so this asserts
    the FK is satisfied within that single statement rather than assuming it.
    """
    import uuid as _uuid

    from app.services.users import ensure_bootstrapped

    user_id = _uuid.uuid4()
    await session.execute(text("alter table auth.users disable trigger on_auth_user_created"))
    await session.execute(
        text("insert into auth.users (id, email) values (:id, :e)"),
        {"id": user_id, "e": f"{user_id}@example.invalid"},
    )
    await session.execute(text("alter table auth.users enable trigger on_auth_user_created"))
    await session.commit()

    assert await session.scalar(
        text("select count(*) from public.profiles where id = :u"), {"u": user_id}
    ) == 0, "precondition: the trigger really was skipped"

    await ensure_bootstrapped(session, user_id, "someone@example.invalid")
    await session.commit()

    profiles = await session.scalar(
        text("select count(*) from public.profiles where id = :u"), {"u": user_id})
    prefs = await session.scalar(
        text("select count(*) from public.notification_preferences where user_id = :u"), {"u": user_id})
    follows = await session.scalar(
        text("select count(*) from public.user_topics where user_id = :u"), {"u": user_id})
    assert (profiles, prefs, follows) == (1, 1, 5)


async def test_bootstrap_does_not_resurrect_unfollowed_topics(session, user):
    """Issue #29: /v1/daily runs the bootstrap on every call.

    A user's unfollow is a deletion, so an unconditional topic seed used to
    quietly re-follow everything each morning. The seed must fire only when
    the profile itself is newly created.
    """
    await set_followed_topics(session, user, ["linux-systems"])
    await session.commit()

    # What every GET /v1/daily does before selecting a concept.
    from app.services.users import ensure_bootstrapped

    await ensure_bootstrapped(session, user, f"{user}@example.invalid")
    await session.commit()

    slugs = (await session.execute(
        text("""select t.slug from public.user_topics ut
                join public.topics t on t.id = ut.topic_id
               where ut.user_id = :u"""),
        {"u": user},
    )).scalars().all()
    assert slugs == ["linux-systems"], "the bootstrap must never undo an unfollow"


async def test_completing_after_midnight_finishes_yesterdays_concept(session, user):
    """Issue #33: read at 23:58 (assigned for DAY), tap learned at 00:01 the
    next day. There is no assignment for the new day yet, so completion must
    fall back to DAY, count for DAY, and keep the streak intact."""
    await get_or_create_daily(session, user, today=DAY)

    # The endpoint passes the *new* local day; the concept read was DAY's.
    completion = await complete_today(session, user, DAY + timedelta(days=1))
    assert completion.assigned_for == DAY, "the completion counts for the day it was assigned"

    done = await session.scalar(
        text("""select count(*) from public.daily_assignments
                 where user_id = :u and assigned_for = :d and completed_at is not null"""),
        {"u": user, "d": DAY},
    )
    assert done == 1

    # Streaks are computed as of the new day; DAY's completion is still current.
    stats = await compute_streaks(session, user, DAY + timedelta(days=1))
    assert stats.current == 1


async def test_a_missed_older_day_cannot_be_back_completed(session, user):
    """The grace window is one day: an assignment from two days ago must not be
    silently completable, which would let a user repair a long-broken streak."""
    await get_or_create_daily(session, user, today=DAY)

    # Two days later, with no assignment in the {today, yesterday} window.
    with pytest.raises(HTTPException) as exc:
        await complete_today(session, user, DAY + timedelta(days=2))
    assert exc.value.status_code == 404

    still_open = await session.scalar(
        text("""select count(*) from public.daily_assignments
                 where user_id = :u and assigned_for = :d and completed_at is null"""),
        {"u": user, "d": DAY},
    )
    assert still_open == 1, "the older assignment stays incomplete"


async def test_completing_prefers_today_over_yesterday(session, user):
    """With both days assigned and uncompleted, completion targets today —
    yesterday stays missed rather than being silently finished."""
    await get_or_create_daily(session, user, today=DAY)
    await get_or_create_daily(session, user, today=DAY + timedelta(days=1))

    completion = await complete_today(session, user, DAY + timedelta(days=1))
    assert completion.assigned_for == DAY + timedelta(days=1)

    yesterday_open = await session.scalar(
        text("""select count(*) from public.daily_assignments
                 where user_id = :u and assigned_for = :d and completed_at is null"""),
        {"u": user, "d": DAY},
    )
    assert yesterday_open == 1, "yesterday's missed day is not back-completed"
