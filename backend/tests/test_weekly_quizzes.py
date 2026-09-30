"""Weekly quiz integration coverage against the real PostgreSQL schema."""

import json

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
        async with sessionmaker_for_test() as session:
            yield session

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user, email="learner@example.invalid"
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as value:
        yield value
    app.dependency_overrides.clear()


def _mcqs(number: int) -> list[dict]:
    return [
        {
            "question": f"What does reviewed concept {number} establish for reliable learning?",
            "options": [
                "The first answer",
                "The second answer",
                "The third answer",
                "The fourth answer",
            ],
            "correct_index": number % 4,
        },
        {
            "question": f"Which detail belongs to reviewed concept {number} in a weekly quiz?",
            "options": ["One", "Two", "Three", "Four"],
            "correct_index": (number + 1) % 4,
        },
        {
            "question": f"How should a learner apply reviewed concept {number} safely?",
            "options": ["Carefully", "Quickly", "Never", "Randomly"],
            "correct_index": (number + 2) % 4,
        },
    ]


async def _make_eligible(sessionmaker_for_test, user):
    async with sessionmaker_for_test() as session:
        concepts = (
            (
                await session.execute(
                    text("""
            select id from public.concepts where status='published' order by id limit 7
        """)
                )
            )
            .scalars()
            .all()
        )
        assert len(concepts) == 7
        for index, concept_id in enumerate(concepts):
            await session.execute(
                text("""
                update public.concepts set mcqs=cast(:mcqs as jsonb) where id=:id
            """),
                {"id": concept_id, "mcqs": json.dumps(_mcqs(index))},
            )
            await session.execute(
                text("""
                insert into public.daily_assignments(id,user_id,concept_id,assigned_for,completed_at)
                values(gen_random_uuid(),:user_id,:concept_id,date '2025-01-01' + cast(:day as integer),now())
            """),
                {"user_id": user, "concept_id": concept_id, "day": index},
            )
        await session.commit()


async def test_weekly_quiz_requires_seven_completed_reviewed_concepts(client):
    response = await client.get("/v1/quizzes/weekly")
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["available_concepts"] == 0
    assert body["required_concepts"] == 7


async def test_weekly_quiz_freezes_questions_and_records_append_only_attempts(
    client,
    sessionmaker_for_test,
    user,
):
    await _make_eligible(sessionmaker_for_test, user)
    first = await client.get("/v1/quizzes/weekly")
    assert first.status_code == 200, first.text
    quiz = first.json()
    assert quiz["available"] is True
    assert len(quiz["questions"]) == 7
    assert len({question["concept_slug"] for question in quiz["questions"]}) == 7
    assert all("correct_index" not in question for question in quiz["questions"])

    again = (await client.get("/v1/quizzes/weekly")).json()
    assert again == quiz, "the current week's learner-facing quiz is frozen"
    # The mobile client updates this profile setting when a learner travels.
    # A changing local date must not mint a second weekly quiz snapshot.
    async with sessionmaker_for_test() as session:
        await session.execute(
            text("update public.profiles set timezone='Pacific/Honolulu' where id=:id"),
            {"id": user},
        )
        await session.commit()
    assert (await client.get("/v1/quizzes/weekly")).json() == quiz
    answers = [
        {"question_id": question["id"], "selected_index": 0}
        for question in quiz["questions"]
    ]
    submitted = await client.post(
        f"/v1/quizzes/weekly/{quiz['quiz_id']}/attempts", json={"answers": answers}
    )
    assert submitted.status_code == 200, submitted.text
    attempt = submitted.json()
    assert attempt["correct_count"] == sum(
        result["correct"] for result in attempt["results"]
    )
    assert len(attempt["results"]) == 7

    retry = await client.post(
        f"/v1/quizzes/weekly/{quiz['quiz_id']}/attempts", json={"answers": answers}
    )
    assert retry.status_code == 200
    assert retry.json()["attempt_id"] != attempt["attempt_id"]
    async with sessionmaker_for_test() as session:
        count = await session.scalar(
            text("select count(*) from public.weekly_quiz_attempts where user_id=:id"),
            {"id": user},
        )
        assert count == 2
        with pytest.raises(Exception, match="immutable"):
            await session.execute(
                text(
                    "update public.weekly_quiz_attempts set correct_count=7 where user_id=:id"
                ),
                {"id": user},
            )
        await session.rollback()


async def test_weekly_quiz_rejects_changed_question_set(
    client, sessionmaker_for_test, user
):
    await _make_eligible(sessionmaker_for_test, user)
    quiz = (await client.get("/v1/quizzes/weekly")).json()
    answers = [
        {"question_id": question["id"], "selected_index": 0}
        for question in quiz["questions"]
    ]
    answers[-1]["question_id"] = "forged-question"
    rejected = await client.post(
        f"/v1/quizzes/weekly/{quiz['quiz_id']}/attempts", json={"answers": answers}
    )
    assert rejected.status_code == 400

    async with sessionmaker_for_test() as session:
        attempts = await session.scalar(
            text("select count(*) from public.weekly_quiz_attempts where user_id=:id"),
            {"id": user},
        )
        assert attempts == 0
