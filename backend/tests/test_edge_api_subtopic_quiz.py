"""Optional subtopic quiz snapshots remain tied to their owner's completed catalog."""

import hashlib
import json
import uuid

import pytest
from sqlalchemy import text


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_subtopic_quiz_waits_for_reviewed_catalog_and_freezes(session, user):
    rows = (await session.execute(text("""select c.id, c.subtopic_id from public.concepts c
      join public.subtopics s on s.id=c.subtopic_id
      where s.slug='probability' and c.status='published' order by c.id limit 3"""))).all()
    assert len(rows) == 3
    ids = [row.id for row in rows]
    completion = uuid.uuid4()
    await session.execute(text("""insert into public.user_subtopic_completions
      (id,user_id,subtopic_id,catalog_signature,catalog_concept_ids)
      values(:id,:uid,:sid,repeat('0',64),cast(:ids as uuid[]))"""),
      {"id": completion, "uid": user, "sid": rows[0].subtopic_id, "ids": ids})
    query = text("select public.edge_api_subtopic_quiz(:uid,:completion)")
    unavailable = _json(await session.scalar(query, {"uid": user, "completion": completion}))
    assert unavailable["available"] is False
    assert (unavailable["reviewed_concepts"], unavailable["required_concepts"]) == (0, 3)
    for n, concept_id in enumerate(ids):
        questions = [{"question": f"Question {n} choice {i}?", "options": ["A", "B", "C", "D"],
                      "correct_index": i} for i in range(3)]
        await session.execute(text("update public.concepts set mcqs=cast(:mcqs as jsonb) where id=:cid"),
                              {"cid": concept_id, "mcqs": json.dumps(questions)})
    result = _json(await session.scalar(query, {"uid": user, "completion": completion}))
    assert result["available"] is True and len(result["questions"]) == 3
    assert all("correct_index" not in q for q in result["questions"])
    expected = sorted(ids, key=lambda cid: hashlib.sha256(
        f"{completion}:select:{cid}".encode()).digest())
    assert [uuid.UUID(q["id"].split(":")[0]) for q in result["questions"]] == expected
    stored = _json(await session.scalar(text("select questions from public.subtopic_quizzes where id=:qid"),
                                       {"qid": result["quiz_id"]}))
    for q in stored:
        cid, version, index = q["id"].split(":")
        expected_index = int.from_bytes(hashlib.sha256(f"{completion}:{cid}".encode()).digest()[:2], "big") % 3
        assert int(index) == expected_index and q["content_version"] == int(version)
    await session.execute(text("update public.concepts set mcqs=null where id=:cid"), {"cid": ids[0]})
    assert _json(await session.scalar(query, {"uid": user, "completion": completion})) == result
    assert _json(await session.scalar(query, {"uid": uuid.uuid4(), "completion": completion})) is None
    assert _json(await session.scalar(query, {"uid": user, "completion": uuid.uuid4()}))["error"] == "unavailable"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated', 'public.edge_api_subtopic_quiz(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.edge_api_subtopic_quiz(uuid,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
    submit = text("select public.edge_api_submit_subtopic_quiz(:uid,:qid,cast(:answers as jsonb))")
    answers = [{"question_id": q["id"], "selected_index": q["correct_index"]} for q in stored]
    changed = answers.copy()
    changed[-1] = {"question_id": "forged-question", "selected_index": 0}
    assert _json(await session.scalar(submit, {"uid": user, "qid": result["quiz_id"],
                                               "answers": json.dumps(changed)}))["error"] == "invalid"
    attempt = _json(await session.scalar(submit, {"uid": user, "qid": result["quiz_id"],
                                                  "answers": json.dumps(answers)}))
    assert (attempt["correct_count"], attempt["question_count"]) == (3, 3)
    assert all(item["correct"] for item in attempt["results"])
    retry = _json(await session.scalar(submit, {"uid": user, "qid": result["quiz_id"],
                                                "answers": json.dumps(answers)}))
    assert retry["attempt_id"] != attempt["attempt_id"]
    assert _json(await session.scalar(submit, {"uid": uuid.uuid4(), "qid": result["quiz_id"],
                                               "answers": json.dumps(answers)}))["error"] == "unavailable"
    assert await session.scalar(text("select count(*) from public.subtopic_quiz_attempts where user_id=:uid"),
                                {"uid": user}) == 2
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_submit_subtopic_quiz(uuid,uuid,jsonb)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_submit_subtopic_quiz(uuid,uuid,jsonb)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
    history = text("select public.edge_api_subtopic_quiz_attempts(:uid,:completion)")
    listed = _json(await session.scalar(history, {"uid": user, "completion": completion}))
    assert len(listed["items"]) == 2
    assert {item["attempt_id"] for item in listed["items"]} == {
        attempt["attempt_id"], retry["attempt_id"]}
    assert all(item["question_count"] == 3 for item in listed["items"])
    assert _json(await session.scalar(history, {"uid": uuid.uuid4(),
                                                "completion": completion}))["error"] == "unavailable"
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_subtopic_quiz_attempts(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_subtopic_quiz_attempts(uuid,uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
