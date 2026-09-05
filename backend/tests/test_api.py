"""HTTP-level tests: auth gating, response shape, and status codes."""

import uuid
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.main import app


@pytest_asyncio.fixture
async def client(sessionmaker_for_test, user):
    async def _db_override():
        async with sessionmaker_for_test() as s:
            yield s

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user, email="learner@example.invalid"
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon_client(sessionmaker_for_test):
    async def _db_override():
        async with sessionmaker_for_test() as s:
            yield s

    app.dependency_overrides[get_db] = _db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_health_touches_the_database(anon_client):
    response = await anon_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "reachable"}


@pytest.mark.parametrize("path", ["/v1/daily", "/v1/topics"])
async def test_endpoints_require_a_token(anon_client, path):
    response = await anon_client.get(path)
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


async def test_daily_returns_todays_concept(client):
    response = await client.get("/v1/daily")
    assert response.status_code == 200

    body = response.json()
    assert body["learned"] is False
    assert body["completed_at"] is None
    assert body["outside_followed_topics"] is False

    concept = body["concept"]
    assert uuid.UUID(concept["id"])
    for field in ("slug", "title", "summary", "topic_slug", "topic_name"):
        assert concept[field], f"{field} should not be empty"


async def test_daily_is_stable_across_calls(client):
    first = (await client.get("/v1/daily")).json()
    second = (await client.get("/v1/daily")).json()
    assert first["concept"]["id"] == second["concept"]["id"]
    assert first["assigned_for"] == second["assigned_for"]


async def test_topics_lists_the_catalog_with_follow_state(client):
    response = await client.get("/v1/topics")
    assert response.status_code == 200

    topics = response.json()
    assert len(topics) == 5
    assert {t["slug"] for t in topics} == {
        "artificial-intelligence", "software-engineering",
        "computer-science", "mathematics", "linux-systems",
    }
    assert all(t["concept_count"] == 4 for t in topics)
    # The trigger follows every active topic by default.
    assert all(t["following"] is True for t in topics)


async def test_no_endpoint_accepts_a_user_id(client, user):
    """Identity must come from the token; a supplied id must be ignored."""
    other = uuid.uuid4()
    mine = (await client.get("/v1/daily")).json()
    spoofed = (await client.get(f"/v1/daily?user_id={other}")).json()
    assert mine["concept"]["id"] == spoofed["concept"]["id"]


async def test_daily_exhaustion_is_a_409_not_a_500(client, sessionmaker_for_test, user):
    """Issue #30: the exhausted body must actually reach the client.

    The service layer was covered, but the HTTP layer silently 500'd on the
    response_model mismatch — so this test goes through the real route.
    """
    # Assign every published concept to this user on distinct past days.
    async with sessionmaker_for_test() as s:
        await s.execute(text("""
            insert into public.daily_assignments (id, user_id, concept_id, assigned_for)
            select gen_random_uuid(), :u, c.id,
                   date '2000-01-01' + (row_number() over (order by c.id))::int
              from public.concepts c
             where c.status = 'published'
        """), {"u": user})
        await s.commit()

    response = await client.get("/v1/daily")

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["reason"] == "catalog_exhausted"
    # The client contract is an ISO date string — a datetime or epoch would
    # be truthy too, so parse it rather than merely checking presence.
    date.fromisoformat(body["assigned_for"])


async def test_push_token_deregistration_is_scoped_to_the_caller(client, sessionmaker_for_test, user):
    """Issue #48: sign-out deregisters this handset — and only this handset.

    Deleting by token string alone would let anyone with a leaked token
    silence another user's reminders.
    """
    other = uuid.uuid4()
    async with sessionmaker_for_test() as s:
        await s.execute(
            text("insert into auth.users (id, email) values (:id, :e)"),
            {"id": other, "e": f"{other}@example.invalid"},
        )
        await s.execute(text("""
            insert into public.device_tokens (user_id, expo_push_token, platform)
            values (:mine, 'ExponentPushToken[dereg-mine]', 'android'),
                   (:theirs, 'ExponentPushToken[dereg-theirs]', 'android')
        """), {"mine": user, "theirs": other})
        await s.commit()

    try:
        # Own token: deleted.
        response = await client.request(
            "DELETE", "/v1/me/push-token",
            json={"expo_push_token": "ExponentPushToken[dereg-mine]"},
        )
        assert response.status_code == 204

        # Someone else's token: the request succeeds but must delete nothing.
        response = await client.request(
            "DELETE", "/v1/me/push-token",
            json={"expo_push_token": "ExponentPushToken[dereg-theirs]"},
        )
        assert response.status_code == 204

        async with sessionmaker_for_test() as s:
            mine = await s.scalar(text(
                "select count(*) from public.device_tokens where expo_push_token = 'ExponentPushToken[dereg-mine]'"))
            theirs = await s.scalar(text(
                "select count(*) from public.device_tokens where expo_push_token = 'ExponentPushToken[dereg-theirs]'"))
        assert mine == 0, "the caller's own registration is removed"
        assert theirs == 1, "another user's registration must be untouchable"
    finally:
        # Unconditional: a leaked token (or its trigger-created user, whose
        # default prefs make them due at 08:05) would poison later reminder
        # tests in this session-scoped database even when THIS test fails.
        async with sessionmaker_for_test() as s:
            await s.execute(
                text("delete from public.device_tokens where expo_push_token = any(:t)"),
                {"t": ["ExponentPushToken[dereg-mine]", "ExponentPushToken[dereg-theirs]"]},
            )
            await s.execute(text("delete from auth.users where id = :o"), {"o": other})
            await s.commit()


async def test_bodyless_deregistration_fails_closed(client, sessionmaker_for_test, user):
    """A stripped DELETE body must drop all of the caller's registrations —
    never 422 into a silent no-op that leaves reminders following the account."""
    other = uuid.uuid4()
    try:
        async with sessionmaker_for_test() as s:
            await s.execute(
                text("insert into auth.users (id, email) values (:id, :e)"),
                {"id": other, "e": f"{other}@example.invalid"},
            )
            await s.execute(text("""
                insert into public.device_tokens (user_id, expo_push_token, platform)
                values (:mine, 'ExponentPushToken[bodyless-a]', 'android'),
                       (:mine, 'ExponentPushToken[bodyless-b]', 'android'),
                       (:theirs, 'ExponentPushToken[bodyless-c]', 'android')
            """), {"mine": user, "theirs": other})
            await s.commit()

        response = await client.request("DELETE", "/v1/me/push-token")
        assert response.status_code == 204, response.text

        async with sessionmaker_for_test() as s:
            mine = await s.scalar(text(
                "select count(*) from public.device_tokens where user_id = :u"), {"u": user})
            theirs = await s.scalar(text(
                "select count(*) from public.device_tokens where user_id = :u"), {"u": other})
        assert mine == 0, "all of the caller's registrations are dropped"
        assert theirs == 1, "other accounts' registrations are untouched"
    finally:
        async with sessionmaker_for_test() as s:
            await s.execute(
                text("delete from public.device_tokens where expo_push_token like 'ExponentPushToken[bodyless-%'"))
            await s.execute(text("delete from auth.users where id = :o"), {"o": other})
            await s.commit()


async def test_complete_after_midnight_reports_yesterday_via_the_endpoint(
    client, sessionmaker_for_test, user
):
    """Issue #33 at the HTTP layer: with only yesterday's assignment present,
    POST /v1/daily/complete must succeed and report the day it counted for."""
    async with sessionmaker_for_test() as s:
        # assigned_for = the endpoint's local_today (UTC) minus one day.
        yesterday = await s.scalar(text("select (now() at time zone 'UTC')::date - 1"))
        await s.execute(text("""
            insert into public.daily_assignments (id, user_id, concept_id, assigned_for)
            select gen_random_uuid(), :u, c.id, :d
              from public.concepts c where c.status = 'published' limit 1
        """), {"u": user, "d": yesterday})
        await s.commit()

    response = await client.post("/v1/daily/complete")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["completed"] is True
    assert body["assigned_for"] == str(yesterday), "counts for the day it was assigned, not the new day"

    async with sessionmaker_for_test() as s:
        done = await s.scalar(
            text("""select count(*) from public.daily_assignments
                     where user_id = :u and assigned_for = :d and completed_at is not null"""),
            {"u": user, "d": yesterday},
        )
    assert done == 1


async def test_patch_unknown_timezone_is_a_400_not_a_500(client, sessionmaker_for_test, user):
    """Issue #36: an unknown zone must be a clean 400, and a display_name sent
    in the same request must not be half-applied."""
    response = await client.patch(
        "/v1/me", json={"timezone": "America/Nowhere", "display_name": "Should Not Stick"}
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Unknown timezone"

    async with sessionmaker_for_test() as s:
        row = (await s.execute(
            text("select timezone, display_name from public.profiles where id = :u"), {"u": user}
        )).one()
    assert row.timezone == "UTC", "an invalid request leaves the timezone unchanged"
    assert row.display_name != "Should Not Stick", "the whole PATCH is rejected atomically"


async def test_patch_posix_style_timezone_is_rejected(client):
    """POSIX strings like 'FOO5' are accepted by AT TIME ZONE but are not real
    IANA zones — the catalogue check rejects them where the old one let them
    through silently."""
    response = await client.patch("/v1/me", json={"timezone": "FOO5"})
    assert response.status_code == 400, response.text


async def test_patch_valid_timezone_and_name_apply_together(client, sessionmaker_for_test, user):
    response = await client.patch(
        "/v1/me", json={"timezone": "Asia/Karachi", "display_name": "Muawiya"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["timezone"] == "Asia/Karachi"
    assert body["display_name"] == "Muawiya"

    async with sessionmaker_for_test() as s:
        row = (await s.execute(
            text("select timezone, display_name from public.profiles where id = :u"), {"u": user}
        )).one()
    assert (row.timezone, row.display_name) == ("Asia/Karachi", "Muawiya")


async def test_patch_lowercase_timezone_is_accepted_and_normalized(client, sessionmaker_for_test, user):
    """Postgres zone lookups are case-insensitive; a valid but lowercase zone
    must be accepted and stored in its canonical spelling, not 400'd."""
    response = await client.patch("/v1/me", json={"timezone": "asia/karachi"})
    assert response.status_code == 200, response.text
    assert response.json()["timezone"] == "Asia/Karachi"

    async with sessionmaker_for_test() as s:
        stored = await s.scalar(
            text("select timezone from public.profiles where id = :u"), {"u": user}
        )
    assert stored == "Asia/Karachi", "the canonical name is stored, not the input casing"


async def test_saved_concepts_carry_title_and_topic(client):
    """Issue #90: /v1/me/state must return saved concepts WITH their title and
    topic, so the Profile can render the saved list without the bundled demo
    catalog. `bookmarks` still carries the bare slug for membership/count."""
    daily = (await client.get("/v1/daily")).json()
    slug = daily["concept"]["slug"]

    saved = await client.put(f"/v1/concepts/{slug}/save")
    assert saved.status_code < 300

    state = (await client.get("/v1/me/state")).json()
    assert slug in state["bookmarks"], "slug still tracked for membership/count"
    entry = next((s for s in state["saved"] if s["concept_slug"] == slug), None)
    assert entry is not None, "the saved concept must appear in state.saved"
    assert entry["title"], "saved concept carries its title"
    assert entry["topic_name"], "saved concept carries its topic"


async def test_like_count_counts_other_users_only(client, sessionmaker_for_test):
    """Issue #95: a concept's public like_count counts OTHER users' likes and
    excludes the viewer (the client adds the viewer's own like on top). The count
    also rides along on the /me/state learned and saved lists."""
    import uuid as _uuid

    daily = (await client.get("/v1/daily")).json()
    slug = daily["concept"]["slug"]
    assert daily["concept"]["like_count"] == 0

    # The viewer's own like never counts toward the number shown.
    assert (await client.put(f"/v1/concepts/{slug}/like")).status_code < 300
    assert (await client.get("/v1/daily")).json()["concept"]["like_count"] == 0

    # Another user's like does count.
    other = _uuid.uuid4()
    async with sessionmaker_for_test() as s:
        await s.execute(
            text("insert into auth.users (id, email) values (:id, :e)"),
            {"id": other, "e": f"{other}@example.invalid"},
        )
        await s.execute(
            text("""
                insert into public.concept_interactions (user_id, concept_id, liked_at)
                select :u, c.id, now() from public.concepts c where c.slug = :slug
            """),
            {"u": other, "slug": slug},
        )
        await s.commit()

    assert (await client.get("/v1/daily")).json()["concept"]["like_count"] == 1

    # And the count appears on the saved and learned lists too.
    await client.put(f"/v1/concepts/{slug}/save")
    await client.post("/v1/daily/complete")
    state = (await client.get("/v1/me/state")).json()
    saved_entry = next(s for s in state["saved"] if s["concept_slug"] == slug)
    assert saved_entry["like_count"] == 1
    learned_entry = next(r for r in state["learned"] if r["concept_slug"] == slug)
    assert learned_entry["like_count"] == 1
