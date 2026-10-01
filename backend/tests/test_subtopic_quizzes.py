"""Integration coverage for optional subtopic quizzes on real PostgreSQL."""

import json
import uuid

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
            "question": f"What does reviewed subtopic concept {number} establish for reliable learning?",
            "options": ["First", "Second", "Third", "Fourth"],
            "correct_index": number % 4,
        },
        {
            "question": f"Which detail belongs to reviewed subtopic concept {number}?",
            "options": ["One", "Two", "Three", "Four"],
            "correct_index": (number + 1) % 4,
        },
        {
            "question": f"How should a learner apply reviewed subtopic concept {number}?",
            "options": ["Carefully", "Quickly", "Never", "Randomly"],
            "correct_index": (number + 2) % 4,
        },
    ]


async def _completed_probability_subtopic(sessionmaker_for_test, user, reviewed: bool):
    async with sessionmaker_for_test() as session:
        rows = (await session.execute(text("""
            select c.id,c.subtopic_id from public.concepts c
            join public.subtopics s on s.id=c.subtopic_id
           where s.slug='probability' and c.status='published'
           order by c.id limit 3
        """))).all()
        assert len(rows) == 3
        ids = [row.id for row in rows]
        if reviewed:
            for number, concept_id in enumerate(ids):
                await session.execute(text("""
                    update public.concepts set mcqs=cast(:mcqs as jsonb) where id=:id
                """), {"id": concept_id, "mcqs": json.dumps(_mcqs(number))})
        await session.execute(text("""
            insert into public.user_subtopic_completions
              (id,user_id,subtopic_id,catalog_signature,catalog_concept_ids)
            values (:id,:uid,:sid,
              md5(array_to_string(cast(:concept_ids as uuid[]), ',')) ||
                md5('one-concept-subtopic-v1:' || array_to_string(cast(:concept_ids as uuid[]), ',')),
              cast(:concept_ids as uuid[]))
        """), {
            "id": uuid.uuid4(), "uid": user, "sid": rows[0].subtopic_id,
            "concept_ids": ids,
        })
        event_id = await session.scalar(text("""
            select id from public.user_subtopic_completions
             where user_id=:uid and subtopic_id=:sid
        """), {"uid": user, "sid": rows[0].subtopic_id})
        await session.commit()
        return event_id, ids


async def test_subtopic_quiz_waits_for_reviewed_questions(client, sessionmaker_for_test, user):
    completion_id, _ = await _completed_probability_subtopic(
        sessionmaker_for_test, user, reviewed=False
    )
    response = await client.get(f"/v1/quizzes/subtopics/{completion_id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] is False
    assert (body["reviewed_concepts"], body["required_concepts"]) == (0, 3)
    progress = (await client.get("/v1/me/subtopics/progress")).json()["items"]
    probability = next(item for item in progress if item["subtopic_slug"] == "probability")
    assert probability["completion_id"] == str(completion_id)


async def test_subtopic_quiz_freezes_completed_catalog_and_preserves_attempt_history(
    client, sessionmaker_for_test, user,
):
    completion_id, concept_ids = await _completed_probability_subtopic(
        sessionmaker_for_test, user, reviewed=True
    )
    first = await client.get(f"/v1/quizzes/subtopics/{completion_id}")
    assert first.status_code == 200, first.text
    quiz = first.json()
    assert quiz["available"] is True
    assert len(quiz["questions"]) == 3
    assert all("correct_index" not in question for question in quiz["questions"])
    assert {uuid.UUID(question["id"].split(":")[0]) for question in quiz["questions"]} == set(concept_ids)

    async with sessionmaker_for_test() as session:
        await session.execute(text("""
            update public.concepts set content_version=content_version+1,mcqs=cast(:mcqs as jsonb)
             where id=:id
        """), {"id": concept_ids[0], "mcqs": json.dumps(_mcqs(9))})
        await session.commit()
    assert (await client.get(f"/v1/quizzes/subtopics/{completion_id}")).json() == quiz

    answers = [
        {"question_id": question["id"], "selected_index": 0}
        for question in quiz["questions"]
    ]
    submitted = await client.post(
        f"/v1/quizzes/subtopics/{quiz['quiz_id']}/attempts", json={"answers": answers}
    )
    assert submitted.status_code == 200, submitted.text
    attempt = submitted.json()
    assert attempt["question_count"] == 3
    assert attempt["correct_count"] == sum(result["correct"] for result in attempt["results"])
    assert all("correct_index" in result for result in attempt["results"])

    retried = await client.post(
        f"/v1/quizzes/subtopics/{quiz['quiz_id']}/attempts", json={"answers": answers}
    )
    assert retried.status_code == 200
    assert retried.json()["attempt_id"] != attempt["attempt_id"]
    history = (await client.get(f"/v1/quizzes/subtopics/{completion_id}/attempts")).json()["items"]
    assert len(history) == 2
    assert {item["attempt_id"] for item in history} == {attempt["attempt_id"], retried.json()["attempt_id"]}

    async with sessionmaker_for_test() as session:
        with pytest.raises(Exception, match="immutable"):
            await session.execute(text("""
                update public.subtopic_quiz_attempts set correct_count=7 where user_id=:uid
            """), {"uid": user})
        await session.rollback()


async def test_subtopic_quiz_rejects_changed_question_set(client, sessionmaker_for_test, user):
    completion_id, _ = await _completed_probability_subtopic(
        sessionmaker_for_test, user, reviewed=True
    )
    quiz = (await client.get(f"/v1/quizzes/subtopics/{completion_id}")).json()
    answers = [
        {"question_id": question["id"], "selected_index": 0}
        for question in quiz["questions"]
    ]
    answers[-1]["question_id"] = "forged-question"
    rejected = await client.post(
        f"/v1/quizzes/subtopics/{quiz['quiz_id']}/attempts", json={"answers": answers}
    )
    assert rejected.status_code == 400
    assert (await client.get(f"/v1/quizzes/subtopics/{completion_id}/attempts")).json()["items"] == []


async def test_subtopic_quiz_history_is_account_scoped(client, sessionmaker_for_test, user):
    completion_id, _ = await _completed_probability_subtopic(
        sessionmaker_for_test, user, reviewed=True
    )
    other = uuid.uuid4()
    async with sessionmaker_for_test() as session:
        await session.execute(text("""
            insert into auth.users (id,email) values (:id,:email)
        """), {"id": other, "email": f"{other}@example.invalid"})
        await session.commit()
    try:
        assert (await client.get(f"/v1/quizzes/subtopics/{completion_id}/attempts")).json()["items"] == []
    finally:
        async with sessionmaker_for_test() as session:
            await session.execute(text("delete from auth.users where id=:id"), {"id": other})
            await session.commit()


async def test_authenticated_clients_cannot_write_subtopic_quiz_records(session, user):
    rows = (await session.execute(text("""
        select c.id,c.subtopic_id from public.concepts c join public.subtopics s on s.id=c.subtopic_id
         where s.slug='probability' and c.status='published' order by c.id limit 3
    """))).all()
    completion_id = uuid.uuid4()
    await session.execute(text("""
        insert into public.user_subtopic_completions
          (id,user_id,subtopic_id,catalog_signature,catalog_concept_ids)
        values (:id,:uid,:sid,repeat('0',64),cast(:concept_ids as uuid[]))
    """), {"id": completion_id, "uid": user, "sid": rows[0].subtopic_id,
             "concept_ids": [row.id for row in rows]})
    await session.execute(text("""
        grant select,insert,update,delete on public.subtopic_quizzes,
          public.subtopic_quiz_attempts to authenticated
    """))
    await session.execute(text("set local role authenticated"))
    with pytest.raises(Exception, match="row-level security"):
        await session.execute(text("""
            insert into public.subtopic_quizzes (user_id,subtopic_completion_id,questions)
            values (:uid,:completion_id,'[]'::jsonb)
        """), {"uid": user, "completion_id": completion_id})
    await session.rollback()

async def test_database_rejects_cross_account_quiz_ownership(session, user):
    rows = (await session.execute(text("""
        select c.id,c.subtopic_id from public.concepts c join public.subtopics s on s.id=c.subtopic_id
         where s.slug='probability' and c.status='published' order by c.id limit 3
    """))).all()
    other = uuid.uuid4()
    completion_id = uuid.uuid4()
    try:
        await session.execute(text("""
            insert into auth.users (id,email) values (:id,:email)
        """), {"id": other, "email": f"{other}@example.invalid"})
        await session.execute(text("""
            insert into public.user_subtopic_completions
              (id,user_id,subtopic_id,catalog_signature,catalog_concept_ids)
            values (:id,:uid,:sid,
              md5(array_to_string(cast(:concept_ids as uuid[]), ',')) ||
                md5('one-concept-subtopic-v1:' || array_to_string(cast(:concept_ids as uuid[]), ',')),
              cast(:concept_ids as uuid[]))
        """), {"id": completion_id, "uid": user, "sid": rows[0].subtopic_id,
                 "concept_ids": [row.id for row in rows]})
        with pytest.raises(Exception, match="subtopic_quizzes_completion_owner_fkey"):
            await session.execute(text("""
                insert into public.subtopic_quizzes (user_id,subtopic_completion_id,questions)
                values (:other,:completion_id,'[{}]'::jsonb)
            """), {"other": other, "completion_id": completion_id})
        await session.rollback()
    finally:
        async with session.begin():
            await session.execute(text("delete from auth.users where id=:id"), {"id": other})
