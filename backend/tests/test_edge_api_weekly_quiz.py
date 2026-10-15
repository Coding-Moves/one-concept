"""Weekly quiz snapshots stay private, deterministic, and frozen."""

import hashlib
import json

import pytest
from sqlalchemy import text


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_weekly_quiz_requires_seven_reviewed_completions(session, user):
    result = _json(await session.scalar(text("select public.edge_api_weekly_quiz(:uid)"), {"uid": user}))
    assert result["available"] is False
    assert result["available_concepts"] == 0
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated', 'public.edge_api_weekly_quiz(uuid)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.edge_api_weekly_quiz(uuid)', 'EXECUTE')"""))).one()
    assert rights == (False, True)


@pytest.mark.asyncio
async def test_weekly_quiz_matches_legacy_question_choice_and_freezes(session, user):
    concepts = (await session.execute(text("""select id, slug from public.concepts
      where status='published' order by id limit 7"""))).all()
    assert len(concepts) == 7
    for n, concept in enumerate(concepts):
        questions = [{"question": f"Question {n} choice {i}?", "options": ["A", "B", "C", "D"],
                      "correct_index": i} for i in range(3)]
        await session.execute(text("update public.concepts set mcqs=cast(:mcqs as jsonb) where id=:cid"),
                              {"cid": concept.id, "mcqs": json.dumps(questions)})
        await session.execute(text("""insert into public.daily_assignments
          (user_id, concept_id, assigned_for, completed_at)
          values(:uid, :cid, date '2025-01-01' + cast(:n as integer), now())"""),
          {"uid": user, "cid": concept.id, "n": n})
    first = _json(await session.scalar(text("select public.edge_api_weekly_quiz(:uid)"), {"uid": user}))
    assert first["available"] is True and len(first["questions"]) == 7
    assert all("correct_index" not in question for question in first["questions"])
    stored = _json(await session.scalar(text("""select questions from public.weekly_quizzes
      where id=:qid"""), {"qid": first["quiz_id"]}))
    for question in stored:
        concept_id, version, index = question["id"].split(":")
        expected = int.from_bytes(hashlib.sha256(
            f"{user}:{first['week_start']}:{concept_id}".encode()).digest()[:2], "big") % 3
        assert int(index) == expected
        assert question["content_version"] == int(version)
    await session.execute(text("update public.concepts set mcqs=null where id=:cid"), {"cid": concepts[0].id})
    again = _json(await session.scalar(text("select public.edge_api_weekly_quiz(:uid)"), {"uid": user}))
    assert again == first
    assert _json(await session.scalar(text("select public.edge_api_weekly_quiz(:uid)"),
                                      {"uid": concepts[0].id})) is None
    answers = [{"question_id": q["id"], "selected_index": stored[i]["correct_index"]}
               for i, q in enumerate(first["questions"])]
    submit = text("select public.edge_api_submit_weekly_quiz(:uid,:qid,cast(:answers as jsonb))")
    invalid = answers.copy()
    invalid[-1] = {"question_id": "forged-question", "selected_index": 0}
    assert _json(await session.scalar(submit, {"uid": user, "qid": first["quiz_id"],
                                               "answers": json.dumps(invalid)}))["error"] == "invalid"
    assert await session.scalar(text("select count(*) from public.weekly_quiz_attempts where user_id=:uid"),
                                {"uid": user}) == 0
    attempt = _json(await session.scalar(submit, {"uid": user, "qid": first["quiz_id"],
                                                  "answers": json.dumps(answers)}))
    assert attempt["correct_count"] == 7
    assert len(attempt["results"]) == 7
    assert all(result["correct"] for result in attempt["results"])
    retry = _json(await session.scalar(submit, {"uid": user, "qid": first["quiz_id"],
                                                "answers": json.dumps(answers)}))
    assert retry["attempt_id"] != attempt["attempt_id"]
    assert await session.scalar(text("select count(*) from public.weekly_quiz_attempts where user_id=:uid"),
                                {"uid": user}) == 2
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_submit_weekly_quiz(uuid,uuid,jsonb)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_submit_weekly_quiz(uuid,uuid,jsonb)', 'EXECUTE')"""))).one()
    assert rights == (False, True)
