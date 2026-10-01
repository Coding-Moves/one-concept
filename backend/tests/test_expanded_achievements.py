"""The expanded catalog credits immutable facts once and reports real progress."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.services.achievements import award_eligible, collection


async def _definition_awards(session, user):
    result = await session.execute(text("""
        select achievement_code,earned_on,source from public.user_achievements
        where user_id=:uid order by achievement_code
    """), {"uid": user})
    return [dict(row) for row in result.mappings()]


async def _concept_completions(session, user, count, at):
    await session.execute(text("""
        insert into public.user_concept_completions(user_id,concept_id,completed_at)
        select :uid,id,cast(:at as timestamptz) + (n * interval '1 minute')
        from (select id,row_number() over(order by id)-1 as n from public.concepts limit :count) concepts
        on conflict (user_id,concept_id) do nothing
    """), {"uid": user, "count": count, "at": at})


@pytest.mark.parametrize(("count", "expected"), [(1, {"concept_1"}), (5, {"concept_1", "concept_5"})])
async def test_concept_thresholds_are_server_derived_and_idempotent(session, user, count, expected):
    at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    await _concept_completions(session, user, count, at)
    await award_eligible(session, user)
    await award_eligible(session, user)
    awards = await _definition_awards(session, user)
    assert {award["achievement_code"] for award in awards} == expected
    assert all(award["source"] == "completion" for award in awards)


async def test_weekly_quiz_retries_count_once_and_perfect_requires_real_score(session, user):
    at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    quiz_id = await session.scalar(text("""
        insert into public.weekly_quizzes(user_id,week_start,questions)
        values (:uid,'2026-02-02','[{"id":"q1"},{"id":"q2"}]'::jsonb) returning id
    """), {"uid": user})
    for score in (1, 2, 2):
        await session.execute(text("""
            insert into public.weekly_quiz_attempts(quiz_id,user_id,answers,correct_count,attempted_at)
            values (:quiz,:uid,'[]'::jsonb,:score,:at)
        """), {"quiz": quiz_id, "uid": user, "score": score, "at": at})
    await award_eligible(session, user)
    assert {award["achievement_code"] for award in await _definition_awards(session, user)} == {"quiz_1", "perfect_quiz_1"}
    await award_eligible(session, user)
    assert len(await _definition_awards(session, user)) == 2


async def test_subtopic_catalog_revisions_count_one_learning_path(session, user):
    subtopic_id = await session.scalar(text("select id from public.subtopics order by id limit 1"))
    at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    await session.execute(text("""
        insert into public.user_subtopic_completions
          (user_id,subtopic_id,catalog_signature,catalog_concept_ids,completed_at)
        values
          (:uid,:subtopic,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',array[(select id from public.concepts limit 1)],:at),
          (:uid,:subtopic,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',array[(select id from public.concepts limit 1)],:at + interval '1 day')
    """), {"uid": user, "subtopic": subtopic_id, "at": at})
    await award_eligible(session, user)
    awards = await _definition_awards(session, user)
    assert [award["achievement_code"] for award in awards] == ["subtopic_1"]


async def test_collection_reports_category_requirement_and_clamped_progress(session, user):
    at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    await _concept_completions(session, user, 5, at)
    value = await collection(session, user)
    first = next(item for item in value["items"] if item["code"] == "concept_5")
    assert first["category"] == "learning"
    assert first["requirement"] == {"event": "concept_completion"}
    assert first["progress"] == 5
    assert first["earned_on"] == (at + timedelta(minutes=4)).date()


async def test_direct_client_role_cannot_mint_expanded_award(session, user):
    await session.execute(text("grant select,insert,update,delete on public.user_achievements to authenticated"))
    await session.execute(text("set local role authenticated"))
    with pytest.raises(Exception, match="row-level security"):
        await session.execute(text("""
            insert into public.user_achievements(user_id,achievement_code,earned_on,source)
            values (:uid,'concept_1',current_date,'completion')
        """), {"uid": user})
    await session.rollback()
