"""Analytics stays account-scoped and buckets a bounded local-day window."""

import json

import pytest
from sqlalchemy import text


CALL = text("select public.edge_api_analytics(:uid)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_analytics_empty_and_one_local_day_completion(session, user):
    empty = _json(await session.scalar(CALL, {"uid": user}))
    assert empty["total_concepts"] == empty["total_reviews"] == 0
    assert empty["weekly_quiz_attempts"] == empty["correct_answers"] == 0
    assert empty["answered_questions"] == empty["active_days"] == 0
    assert empty["recent_concepts"] == empty["recent_quizzes"] == empty["topics"] == []
    assert len(empty["activity"]) == 28
    assert all(row["concepts"] == row["reviews"] == row["quizzes"] == 0
               for row in empty["activity"])
    assert isinstance(empty["subtopics"], list)
    assert isinstance(empty["achievements"], list)

    await session.execute(text("update public.profiles set timezone='Asia/Karachi' where id=:uid"),
                          {"uid": user})
    await session.execute(text("""
        with chosen as (
          select id from public.concepts where status='published' limit 1
        ), assignment as (
          insert into public.daily_assignments(user_id, concept_id, assigned_for, completed_at)
          select :uid, id, ((now() at time zone 'Asia/Karachi')::date - 1),
                 ((now() at time zone 'Asia/Karachi')::date::timestamp
                   at time zone 'Asia/Karachi') + interval '1 hour'
            from chosen returning id, concept_id, completed_at
        )
        insert into public.user_concept_completions
          (user_id, concept_id, source_assignment_id, completed_at)
        select :uid, concept_id, id, completed_at from assignment
    """), {"uid": user})
    result = _json(await session.scalar(CALL, {"uid": user}))
    assert result["total_concepts"] == 1
    assert len(result["recent_concepts"]) == 1
    assert result["recent_concepts"][0]["concept_slug"]
    assert sum(row["concepts"] for row in result["activity"]) == 1
    assert result["activity"][-1]["concepts"] == 1
    assert result["active_days"] == 1
    assert sum(row["completed_concepts"] for row in result["topics"]) == 1


@pytest.mark.asyncio
async def test_analytics_rpc_is_service_only(session):
    permissions = (await session.execute(text("""
      select has_function_privilege('authenticated',
               'public.edge_api_analytics(uuid)', 'EXECUTE'),
             has_function_privilege('service_role',
               'public.edge_api_analytics(uuid)', 'EXECUTE')
    """))).one()
    assert permissions == (False, True)
