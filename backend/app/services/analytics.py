"""One account-scoped, timezone-correct analytics read model."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.achievements import collection as achievement_collection
from app.services.streaks import compute_streaks
from app.services.subtopic_progress import progress as subtopic_progress

_SUMMARY = text("""
    select
      (select count(*)::int from public.user_concept_completions where user_id=:uid) as total_concepts,
      (select count(*)::int from public.daily_reviews where user_id=:uid and completed_at is not null) as total_reviews,
      (select count(*)::int from public.weekly_quiz_attempts where user_id=:uid) as weekly_quiz_attempts,
      coalesce((select sum(correct_count)::int from public.weekly_quiz_attempts where user_id=:uid),0) as correct_answers,
      coalesce((select sum(jsonb_array_length(q.questions))::int
         from public.weekly_quiz_attempts a join public.weekly_quizzes q on q.id=a.quiz_id
        where a.user_id=:uid),0) as answered_questions
""")

_RECENT_CONCEPTS = text("""
    select c.slug as concept_slug,c.title,t.name as topic_name,done.completed_at
    from public.user_concept_completions done
    join public.concepts c on c.id=done.concept_id
    join public.topics t on t.id=c.topic_id
    where done.user_id=:uid
    order by done.completed_at desc,done.concept_id desc limit 5
""")

_RECENT_QUIZZES = text("""
    select q.week_start,a.attempted_at,a.correct_count,jsonb_array_length(q.questions)::int as question_count
    from public.weekly_quiz_attempts a
    join public.weekly_quizzes q on q.id=a.quiz_id and q.user_id=a.user_id
    where a.user_id=:uid
    order by a.attempted_at desc,a.id desc limit 5
""")

_TOPICS = text("""
    select t.slug as topic_slug,t.name as topic_name,count(done.concept_id)::int as completed_concepts
    from public.user_concept_completions done
    join public.concepts c on c.id=done.concept_id
    join public.topics t on t.id=c.topic_id
    where done.user_id=:uid
    group by t.slug,t.name
    order by completed_concepts desc,t.name
""")

# Every event is grouped using the profile's IANA timezone. The fixed 28-day
# window keeps the response bounded and the chart useful on small screens.
_ACTIVITY = text("""
    with profile as (
      select timezone,(now() at time zone timezone)::date as today,
             ((now() at time zone timezone)::date-27)::timestamp at time zone timezone as window_start,
             ((now() at time zone timezone)::date+1)::timestamp at time zone timezone as window_end
      from public.profiles where id=:uid
    ), events as (
      select completed_at as occurred_at,'concept'::text as kind
      from public.user_concept_completions where user_id=:uid
      union all
      select completed_at,'review' from public.daily_reviews
      where user_id=:uid and completed_at is not null
      union all
      select attempted_at,'quiz' from public.weekly_quiz_attempts where user_id=:uid
    ), totals as (
      select (occurred_at at time zone profile.timezone)::date as day,
             count(*) filter (where kind='concept')::int as concepts,
             count(*) filter (where kind='review')::int as reviews,
             count(*) filter (where kind='quiz')::int as quizzes
      from events cross join profile
      where occurred_at >= profile.window_start and occurred_at < profile.window_end
      group by (occurred_at at time zone profile.timezone)::date
    )
    select day,coalesce(totals.concepts,0)::int as concepts,coalesce(totals.reviews,0)::int as reviews,
           coalesce(totals.quizzes,0)::int as quizzes
    from profile cross join generate_series(profile.today-27,profile.today,interval '1 day') series(day)
    left join totals on totals.day=series.day::date
    order by day
""")


async def analytics(session: AsyncSession, user_id: uuid.UUID) -> dict:
    """Return a bounded snapshot; caller owns the surrounding transaction."""
    # Serialize with completion/review writes, then use the existing achievement
    # reconciliation rather than reimplementing its definitions or progress.
    await session.execute(text("select id from public.profiles where id=:uid for update"), {"uid": user_id})
    summary = (await session.execute(_SUMMARY, {"uid": user_id})).mappings().one()
    streaks = await compute_streaks(session, user_id)
    achievements = await achievement_collection(session, user_id)
    recent_concepts = [dict(row) for row in (await session.execute(_RECENT_CONCEPTS, {"uid": user_id})).mappings()]
    recent_quizzes = [dict(row) for row in (await session.execute(_RECENT_QUIZZES, {"uid": user_id})).mappings()]
    activity = [dict(row) for row in (await session.execute(_ACTIVITY, {"uid": user_id})).mappings()]
    topics = [dict(row) for row in (await session.execute(_TOPICS, {"uid": user_id})).mappings()]
    active_days = sum(1 for row in activity if row["concepts"] or row["reviews"] or row["quizzes"])
    return {
        **dict(summary),
        "current_streak": streaks.current,
        "longest_streak": streaks.longest,
        "active_days": active_days,
        "recent_concepts": recent_concepts,
        "recent_quizzes": recent_quizzes,
        "activity": activity,
        "topics": topics,
        "subtopics": [vars(item) for item in await subtopic_progress(session, user_id)],
        "achievements": achievements["items"],
    }
