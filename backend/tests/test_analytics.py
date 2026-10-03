"""Analytics must agree with accepted records and the learner's local day."""
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text

from tests import test_api

client = test_api.client
anon_client = test_api.anon_client


async def _seed_activity(session, user):
    await session.execute(
        text("update public.profiles set timezone='Asia/Karachi' where id=:uid"),
        {"uid": user},
    )
    concept = await session.scalar(
        text("select id from public.concepts where status='published' order by id limit 1")
    )
    await session.execute(text("""
        insert into public.user_concept_completions(user_id,concept_id,completed_at)
        values (:uid,:concept,now())
        on conflict (user_id,concept_id) do nothing
    """), {"uid": user, "concept": concept})
    await session.execute(text("""
        insert into public.daily_reviews(user_id,concept_id,assigned_for,completed_at)
        values (:uid,:concept,(now() at time zone 'Asia/Karachi')::date,now())
    """), {"uid": user, "concept": concept})
    quiz = await session.scalar(text("""
        insert into public.weekly_quizzes(user_id,week_start,questions)
        values (:uid,(now() at time zone 'Asia/Karachi')::date,'[{"id":"one"},{"id":"two"}]'::jsonb)
        returning id
    """), {"uid": user})
    await session.execute(text("""
        insert into public.weekly_quiz_attempts(quiz_id,user_id,answers,correct_count,attempted_at)
        values (:quiz,:uid,'[]'::jsonb,1,now())
    """), {"uid": user, "quiz": quiz})
    await session.commit()


async def test_analytics_is_authoritative_and_timezone_correct(client, session, user):
    await _seed_activity(session, user)
    response = await client.get("/v1/me/analytics")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_concepts"] == 1
    assert body["total_reviews"] == 1
    assert body["weekly_quiz_attempts"] == 1
    assert body["correct_answers"] == 1
    assert body["answered_questions"] == 2
    assert body["recent_concepts"] and body["recent_concepts"][0]["topic_name"]
    assert len(body["recent_quizzes"]) == 1
    assert body["recent_quizzes"][0]["correct_count"] == 1
    assert body["recent_quizzes"][0]["question_count"] == 2
    local_today = datetime.now(ZoneInfo("Asia/Karachi")).date().isoformat()
    today = next(day for day in body["activity"] if day["day"] == local_today)
    assert today == {"day": local_today, "concepts": 1, "reviews": 1, "quizzes": 1}
    assert body["active_days"] == 1
    assert body["topics"] and body["topics"][0]["completed_concepts"] == 1
    assert body["subtopics"]
    assert len(body["achievements"]) == 32


async def test_analytics_requires_authentication(anon_client):
    assert (await anon_client.get("/v1/me/analytics")).status_code == 401
