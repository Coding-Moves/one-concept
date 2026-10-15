-- Bounded account analytics with each event bucketed in the profile timezone.
begin;

create function public.edge_api_analytics(p_user_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_stats jsonb;
  v_achievements jsonb;
  v_subtopics jsonb;
  v_total_concepts integer;
  v_total_reviews integer;
  v_weekly_attempts integer;
  v_correct integer;
  v_answered integer;
  v_recent_concepts jsonb;
  v_recent_quizzes jsonb;
  v_activity jsonb;
  v_active_days integer;
  v_topics jsonb;
begin
  -- Achievement collection reconciles historical awards and locks this profile.
  v_achievements := public.edge_api_achievements(p_user_id);
  if v_achievements is null then return null; end if;
  select timezone into v_timezone from public.profiles where id = p_user_id;
  v_today := (now() at time zone v_timezone)::date;
  v_stats := public.edge_api_stats(p_user_id);
  v_subtopics := public.edge_api_subtopic_progress(p_user_id);

  select (select count(*)::integer from public.user_concept_completions
           where user_id = p_user_id),
         (select count(*)::integer from public.daily_reviews
           where user_id = p_user_id and completed_at is not null),
         (select count(*)::integer from public.weekly_quiz_attempts
           where user_id = p_user_id),
         coalesce((select sum(correct_count)::integer from public.weekly_quiz_attempts
           where user_id = p_user_id), 0),
         coalesce((select sum(jsonb_array_length(q.questions))::integer
           from public.weekly_quiz_attempts a
           join public.weekly_quizzes q on q.id = a.quiz_id
           where a.user_id = p_user_id), 0)
    into v_total_concepts, v_total_reviews, v_weekly_attempts, v_correct, v_answered;

  select coalesce(jsonb_agg(jsonb_build_object(
    'concept_slug', recent.concept_slug, 'title', recent.title,
    'topic_name', recent.topic_name, 'completed_at', recent.completed_at
  ) order by recent.completed_at desc, recent.concept_id desc), '[]'::jsonb)
    into v_recent_concepts from (
      select c.id as concept_id, c.slug as concept_slug, c.title,
             t.name as topic_name, done.completed_at
        from public.user_concept_completions done
        join public.concepts c on c.id = done.concept_id
        join public.topics t on t.id = c.topic_id
       where done.user_id = p_user_id
       order by done.completed_at desc, done.concept_id desc limit 5
    ) recent;
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', recent.week_start, 'attempted_at', recent.attempted_at,
    'correct_count', recent.correct_count, 'question_count', recent.question_count
  ) order by recent.attempted_at desc, recent.id desc), '[]'::jsonb)
    into v_recent_quizzes from (
      select a.id, q.week_start, a.attempted_at, a.correct_count,
             jsonb_array_length(q.questions)::integer as question_count
        from public.weekly_quiz_attempts a
        join public.weekly_quizzes q on q.id = a.quiz_id and q.user_id = a.user_id
       where a.user_id = p_user_id
       order by a.attempted_at desc, a.id desc limit 5
    ) recent;
  select coalesce(jsonb_agg(jsonb_build_object(
    'topic_slug', grouped.topic_slug, 'topic_name', grouped.topic_name,
    'completed_concepts', grouped.completed_concepts
  ) order by grouped.completed_concepts desc, grouped.topic_name), '[]'::jsonb)
    into v_topics from (
      select t.slug as topic_slug, t.name as topic_name,
             count(done.concept_id)::integer as completed_concepts
        from public.user_concept_completions done
        join public.concepts c on c.id = done.concept_id
        join public.topics t on t.id = c.topic_id
       where done.user_id = p_user_id
       group by t.slug, t.name
    ) grouped;

  with events as (
    select completed_at as occurred_at, 'concept'::text as kind
      from public.user_concept_completions where user_id = p_user_id
    union all
    select completed_at, 'review' from public.daily_reviews
      where user_id = p_user_id and completed_at is not null
    union all
    select attempted_at, 'quiz' from public.weekly_quiz_attempts
      where user_id = p_user_id
  ), totals as (
    select (occurred_at at time zone v_timezone)::date as day,
           count(*) filter (where kind = 'concept')::integer as concepts,
           count(*) filter (where kind = 'review')::integer as reviews,
           count(*) filter (where kind = 'quiz')::integer as quizzes
      from events
     where occurred_at >= (v_today - 27)::timestamp at time zone v_timezone
       and occurred_at < (v_today + 1)::timestamp at time zone v_timezone
     group by (occurred_at at time zone v_timezone)::date
  ), days as (
    select series.day::date as day, coalesce(totals.concepts, 0) as concepts,
           coalesce(totals.reviews, 0) as reviews,
           coalesce(totals.quizzes, 0) as quizzes
      from generate_series(v_today - 27, v_today, interval '1 day') series(day)
      left join totals on totals.day = series.day::date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', day, 'concepts', concepts, 'reviews', reviews, 'quizzes', quizzes
  ) order by day), '[]'::jsonb),
         count(*) filter (where concepts > 0 or reviews > 0 or quizzes > 0)::integer
    into v_activity, v_active_days from days;

  return jsonb_build_object(
    'total_concepts', v_total_concepts, 'total_reviews', v_total_reviews,
    'weekly_quiz_attempts', v_weekly_attempts, 'correct_answers', v_correct,
    'answered_questions', v_answered,
    'current_streak', (v_stats->>'current')::integer,
    'longest_streak', (v_stats->>'longest')::integer,
    'active_days', v_active_days,
    'recent_concepts', v_recent_concepts, 'recent_quizzes', v_recent_quizzes,
    'activity', v_activity, 'topics', v_topics,
    'subtopics', v_subtopics->'items', 'achievements', v_achievements->'items'
  );
end
$$;

revoke all on function public.edge_api_analytics(uuid) from public;
grant execute on function public.edge_api_analytics(uuid) to service_role;

commit;
