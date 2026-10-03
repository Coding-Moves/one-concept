"""Server-issued achievement awards from immutable accepted learning records."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.streaks import compute_streaks

# This evaluator deliberately derives every award from server-owned facts.  The
# user/code primary key makes retries, reconnects and concurrent devices safe.
_AWARD_ELIGIBLE = text("""
    with days as (
        select assigned_for as d from public.daily_assignments
        where user_id=:uid and completed_at is not null
        union
        select assigned_for from public.daily_reviews
        where user_id=:uid and completed_at is not null
    ), streak_islands as (
        select d, d-(row_number() over(order by d))::int as grp from days
    ), streak_facts as (
        select d as earned_on,
               row_number() over(partition by grp order by d)::int as threshold
        from streak_islands
    ), concept_facts as (
        select completed_at::date as earned_on,
               row_number() over(order by completed_at,concept_id)::int as threshold
        from public.user_concept_completions where user_id=:uid
    ), review_facts as (
        select completed_at::date as earned_on,
               row_number() over(order by completed_at,id)::int as threshold
        from public.daily_reviews where user_id=:uid and completed_at is not null
    ), quiz_events as (
        select quiz_id,min(attempted_at) as occurred_at
        from public.weekly_quiz_attempts where user_id=:uid group by quiz_id
    ), quiz_facts as (
        select occurred_at::date as earned_on,
               row_number() over(order by occurred_at,quiz_id)::int as threshold
        from quiz_events
    ), perfect_events as (
        select a.quiz_id,min(a.attempted_at) as occurred_at
        from public.weekly_quiz_attempts a
        join public.weekly_quizzes q on q.id=a.quiz_id and q.user_id=a.user_id
        where a.user_id=:uid and a.correct_count=jsonb_array_length(q.questions)
        group by a.quiz_id
    ), perfect_facts as (
        select occurred_at::date as earned_on,
               row_number() over(order by occurred_at,quiz_id)::int as threshold
        from perfect_events
    ), subtopic_events as (
        select subtopic_id,min(completed_at) as occurred_at
        from public.user_subtopic_completions where user_id=:uid group by subtopic_id
    ), subtopic_facts as (
        select occurred_at::date as earned_on,
               row_number() over(order by occurred_at,subtopic_id)::int as threshold
        from subtopic_events
    ), facts as (
        select 'consecutive_days'::text as metric,threshold,earned_on from streak_facts
        union all select 'completed_concepts',threshold,earned_on from concept_facts
        union all select 'completed_reviews',threshold,earned_on from review_facts
        union all select 'weekly_quizzes_completed',threshold,earned_on from quiz_facts
        union all select 'weekly_perfect_scores',threshold,earned_on from perfect_facts
        union all select 'completed_subtopics',threshold,earned_on from subtopic_facts
    )
    insert into public.user_achievements(user_id,achievement_code,earned_on,source)
    select :uid,d.code,f.earned_on,
      case when :historical then 'history'
           when f.metric in ('consecutive_days','completed_concepts') then 'completion'
           when f.metric='completed_reviews' then 'review'
           when f.metric in ('weekly_quizzes_completed','weekly_perfect_scores') then 'quiz'
           when f.metric='completed_subtopics' then 'subtopic' end
    from facts f
    join public.achievement_definitions d on d.metric=f.metric and d.threshold=f.threshold
    on conflict(user_id,achievement_code) do nothing
""")

_PROGRESS = text("""
    with counts as (
      select 'completed_concepts'::text as metric,count(*)::int as value
      from public.user_concept_completions where user_id=:uid
      union all
      select 'completed_reviews',count(*)::int from public.daily_reviews
      where user_id=:uid and completed_at is not null
      union all
      select 'weekly_quizzes_completed',count(*)::int from (
        select quiz_id from public.weekly_quiz_attempts where user_id=:uid group by quiz_id
      ) quizzes
      union all
      select 'weekly_perfect_scores',count(*)::int from (
        select a.quiz_id from public.weekly_quiz_attempts a
        join public.weekly_quizzes q on q.id=a.quiz_id and q.user_id=a.user_id
        where a.user_id=:uid and a.correct_count=jsonb_array_length(q.questions)
        group by a.quiz_id
      ) quizzes
      union all
      select 'completed_subtopics',count(*)::int from (
        select subtopic_id from public.user_subtopic_completions where user_id=:uid group by subtopic_id
      ) subtopics
    )
    select a.code,a.metric,a.threshold,a.name,a.description,a.artwork_key,a.category,a.requirement,a.show_progress,
           u.earned_on,u.source,u.seen_at,coalesce(c.value,0) as progress
    from public.achievement_definitions a
    left join public.user_achievements u on u.achievement_code=a.code and u.user_id=:uid
    left join counts c on c.metric=a.metric
    order by a.sort_order,a.code
""")


async def award_eligible(
    session: AsyncSession, user_id: uuid.UUID, *, historical: bool = False,
) -> None:
    """Award every definition whose exact server fact has been reached.

    Callers hold the profile lock and own the transaction. Reconciliation uses
    the same evaluator, so a deploy gap or new definition never needs a client
    replay to credit existing learning.
    """
    await session.execute(_AWARD_ELIGIBLE, {"uid": user_id, "historical": historical})


async def award_streaks(
    session: AsyncSession, user_id: uuid.UUID, *, historical: bool = False,
) -> None:
    """Compatibility entry point for existing accepted learning writes."""
    await award_eligible(session, user_id, historical=historical)


async def collection(session: AsyncSession, user_id: uuid.UUID) -> dict:
    # Same lock as accepted writes: badges and progress describe one state.
    await session.execute(text("select id from public.profiles where id=:uid for update"), {"uid": user_id})
    await award_eligible(session, user_id, historical=True)
    stats = await compute_streaks(session, user_id)
    rows = await session.execute(_PROGRESS, {"uid": user_id})
    items = []
    for row in rows.mappings():
        item = dict(row)
        if item["metric"] == "consecutive_days":
            item["progress"] = stats.current
        if not item["show_progress"]:
            item["progress"] = None
        else:
            item["progress"] = min(item["progress"], item["threshold"])
        items.append(item)
    return {"current_streak": stats.current, "longest_streak": stats.longest, "items": items}


async def acknowledge(session: AsyncSession, user_id: uuid.UUID, codes: list[str]) -> None:
    # Never grants an award; only acknowledges existing rows owned by the JWT user.
    await session.execute(text("""
        update public.user_achievements set seen_at=coalesce(seen_at,now())
        where user_id=:uid and achievement_code=any(:codes)
    """), {"uid": user_id, "codes": codes})
