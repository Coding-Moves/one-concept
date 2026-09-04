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
