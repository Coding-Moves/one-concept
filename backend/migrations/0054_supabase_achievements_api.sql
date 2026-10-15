-- Account-scoped achievement collection and acknowledgment for the Edge API.
begin;

create function public.edge_api_achievements(p_user_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_stats jsonb;
  v_existing text[];
  v_items jsonb;
begin
  -- Match first-request bootstrap without creating a daily assignment.
  with created as (
    insert into public.profiles(id, display_name)
    select p_user_id, split_part(u.email, '@', 1)
      from auth.users u where u.id = p_user_id
    on conflict(id) do nothing returning id
  )
  insert into public.user_topics(user_id, topic_id)
  select created.id, t.id from created cross join public.topics t where t.is_active
  on conflict do nothing;
  insert into public.notification_preferences(user_id) values (p_user_id)
  on conflict(user_id) do nothing;
  perform id from public.profiles where id = p_user_id for update;
  if not found then return null; end if;

  select coalesce(array_agg(achievement_code), '{}'::text[]) into v_existing
    from public.user_achievements where user_id = p_user_id;
  perform public.edge_api_award_eligible(p_user_id);
  -- Awards discovered on collection are historical reconciliation, not a new tap.
  update public.user_achievements set source = 'history'
   where user_id = p_user_id and not (achievement_code = any(v_existing));
  v_stats := public.edge_api_stats(p_user_id);

  with counts as (
    select 'completed_concepts'::text as metric, count(*)::integer as value
      from public.user_concept_completions where user_id = p_user_id
    union all
    select 'completed_reviews', count(*)::integer from public.daily_reviews
      where user_id = p_user_id and completed_at is not null
    union all
    select 'weekly_quizzes_completed', count(*)::integer from (
      select quiz_id from public.weekly_quiz_attempts where user_id = p_user_id group by quiz_id
    ) quizzes
    union all
    select 'weekly_perfect_scores', count(*)::integer from (
      select a.quiz_id from public.weekly_quiz_attempts a
      join public.weekly_quizzes q on q.id = a.quiz_id and q.user_id = a.user_id
      where a.user_id = p_user_id and a.correct_count = jsonb_array_length(q.questions)
      group by a.quiz_id
    ) quizzes
    union all
    select 'completed_subtopics', count(*)::integer from (
      select subtopic_id from public.user_subtopic_completions
      where user_id = p_user_id group by subtopic_id
    ) subtopics
  ), rows as (
    select d.*, a.earned_on, a.source, a.seen_at,
      case when d.metric = 'consecutive_days' then (v_stats->>'current')::integer
           else coalesce(c.value, 0) end as progress
      from public.achievement_definitions d
      left join public.user_achievements a
        on a.achievement_code = d.code and a.user_id = p_user_id
      left join counts c on c.metric = d.metric
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', code, 'metric', metric, 'threshold', threshold,
    'name', name, 'description', description, 'artwork_key', artwork_key,
    'category', category, 'requirement', requirement,
    'show_progress', show_progress,
    'progress', case when show_progress then least(progress, threshold) else null end,
    'earned_on', earned_on, 'source', source, 'seen_at', seen_at
  ) order by sort_order, code), '[]'::jsonb) into v_items from rows;
  return jsonb_build_object(
    'current_streak', (v_stats->>'current')::integer,
    'longest_streak', (v_stats->>'longest')::integer,
    'items', v_items
  );
end
$$;

create function public.edge_api_achievements_seen(p_user_id uuid, p_codes text[])
returns void
language sql volatile
set search_path = ''
as $$
  update public.user_achievements set seen_at = coalesce(seen_at, now())
   where user_id = p_user_id and achievement_code = any(p_codes)
$$;

revoke all on function public.edge_api_achievements(uuid) from public;
revoke all on function public.edge_api_achievements_seen(uuid, text[]) from public;
grant execute on function public.edge_api_achievements(uuid) to service_role;
grant execute on function public.edge_api_achievements_seen(uuid, text[]) to service_role;

commit;
