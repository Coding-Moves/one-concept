-- Idempotent, profile-timezone daily completion for the Edge candidate.
begin;

create function public.edge_api_record_subtopic_completion(p_user_id uuid, p_concept_id uuid)
returns jsonb
language sql volatile
set search_path = ''
as $$
  with target as (
    select s.id, s.slug as subtopic_slug, s.name as subtopic_name,
           t.slug as topic_slug, t.name as topic_name
      from public.concepts focus
      join public.subtopics s on s.id = focus.subtopic_id and s.is_active
      join public.topics t on t.id = s.topic_id and t.is_active
     where focus.id = p_concept_id
  ), catalog as (
    select target.*, array_agg(c.id order by c.id) as ids, count(*)::integer as available
      from target join public.concepts c on c.subtopic_id = target.id and c.status = 'published'
     group by target.id, target.subtopic_slug, target.subtopic_name,
              target.topic_slug, target.topic_name
  ), covered as (
    select catalog.*, count(done.concept_id)::integer as completed
      from catalog left join public.user_concept_completions done
        on done.user_id = p_user_id and done.concept_id = any(catalog.ids)
     group by catalog.id, catalog.subtopic_slug, catalog.subtopic_name,
              catalog.topic_slug, catalog.topic_name, catalog.ids, catalog.available
  ), inserted as (
    insert into public.user_subtopic_completions
      (user_id, subtopic_id, catalog_signature, catalog_concept_ids)
    select p_user_id, id,
           md5(array_to_string(covered.ids, ',')) ||
             md5('one-concept-subtopic-v1:' || array_to_string(covered.ids, ',')),
           ids from covered where available > 0 and completed = available
    on conflict(user_id, subtopic_id, catalog_signature) do nothing
    returning id, subtopic_id, completed_at
  )
  select jsonb_build_object(
    'id', inserted.id, 'topic_slug', covered.topic_slug,
    'topic_name', covered.topic_name,
    'subtopic_slug', covered.subtopic_slug,
    'subtopic_name', covered.subtopic_name,
    'completed_at', inserted.completed_at)
    from inserted join covered on covered.id = inserted.subtopic_id
$$;

create function public.edge_api_award_eligible(p_user_id uuid)
returns void
language sql volatile
set search_path = ''
as $$
  with days as (
    select assigned_for as d from public.daily_assignments
      where user_id = p_user_id and completed_at is not null
    union
    select assigned_for from public.daily_reviews
      where user_id = p_user_id and completed_at is not null
  ), streak_islands as (
    select d, d - (row_number() over(order by d))::integer as grp from days
  ), streak_facts as (
    select d as earned_on,
           row_number() over(partition by grp order by d)::integer as threshold
      from streak_islands
  ), concept_facts as (
    select completed_at::date as earned_on,
           row_number() over(order by completed_at, concept_id)::integer as threshold
      from public.user_concept_completions where user_id = p_user_id
  ), review_facts as (
    select completed_at::date as earned_on,
           row_number() over(order by completed_at, id)::integer as threshold
      from public.daily_reviews where user_id = p_user_id and completed_at is not null
  ), quiz_events as (
    select quiz_id, min(attempted_at) as occurred_at
      from public.weekly_quiz_attempts where user_id = p_user_id group by quiz_id
  ), quiz_facts as (
    select occurred_at::date as earned_on,
           row_number() over(order by occurred_at, quiz_id)::integer as threshold
      from quiz_events
  ), perfect_events as (
    select a.quiz_id, min(a.attempted_at) as occurred_at
      from public.weekly_quiz_attempts a
      join public.weekly_quizzes q on q.id = a.quiz_id and q.user_id = a.user_id
     where a.user_id = p_user_id and a.correct_count = jsonb_array_length(q.questions)
     group by a.quiz_id
  ), perfect_facts as (
    select occurred_at::date as earned_on,
           row_number() over(order by occurred_at, quiz_id)::integer as threshold
      from perfect_events
  ), subtopic_events as (
    select subtopic_id, min(completed_at) as occurred_at
      from public.user_subtopic_completions where user_id = p_user_id group by subtopic_id
  ), subtopic_facts as (
    select occurred_at::date as earned_on,
           row_number() over(order by occurred_at, subtopic_id)::integer as threshold
      from subtopic_events
  ), facts as (
    select 'consecutive_days'::text as metric, threshold, earned_on from streak_facts
    union all select 'completed_concepts', threshold, earned_on from concept_facts
    union all select 'completed_reviews', threshold, earned_on from review_facts
    union all select 'weekly_quizzes_completed', threshold, earned_on from quiz_facts
    union all select 'weekly_perfect_scores', threshold, earned_on from perfect_facts
    union all select 'completed_subtopics', threshold, earned_on from subtopic_facts
  )
  insert into public.user_achievements(user_id, achievement_code, earned_on, source)
  select p_user_id, d.code, f.earned_on,
    case when f.metric in ('consecutive_days', 'completed_concepts') then 'completion'
         when f.metric = 'completed_reviews' then 'review'
         when f.metric in ('weekly_quizzes_completed', 'weekly_perfect_scores') then 'quiz'
         when f.metric = 'completed_subtopics' then 'subtopic' end
    from facts f
    join public.achievement_definitions d on d.metric = f.metric and d.threshold = f.threshold
  on conflict(user_id, achievement_code) do nothing
$$;

create function public.edge_api_complete_daily(p_user_id uuid, p_today date default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_today date;
  v_assignment record;
  v_subtopic jsonb;
begin
  select (now() at time zone timezone)::date into v_today
    from public.profiles where id = p_user_id for update;
  if v_today is null then return null; end if;
  v_today := coalesce(p_today, v_today);

  update public.daily_assignments
     set completed_at = coalesce(completed_at, now())
   where id = (
     select id from public.daily_assignments
      where user_id = p_user_id
        and assigned_for in (v_today, v_today - 1)
        and not exists(select 1 from public.daily_reviews r
          where r.user_id = p_user_id and r.assigned_for >= daily_assignments.assigned_for)
      order by assigned_for desc limit 1
   )
  returning id, concept_id, assigned_for, completed_at into v_assignment;
  if not found then return null; end if;

  insert into public.user_concept_completions
    (user_id, concept_id, source_assignment_id, completed_at)
  values (p_user_id, v_assignment.concept_id, v_assignment.id, v_assignment.completed_at)
  on conflict(user_id, concept_id) do nothing;
  v_subtopic := public.edge_api_record_subtopic_completion(p_user_id, v_assignment.concept_id);
  perform public.edge_api_award_eligible(p_user_id);
  return jsonb_build_object(
    'completed', true, 'assigned_for', v_assignment.assigned_for,
    'stats', public.edge_api_stats(p_user_id),
    'subtopic_completion', v_subtopic
  );
end
$$;

revoke all on function public.edge_api_record_subtopic_completion(uuid, uuid) from public;
revoke all on function public.edge_api_award_eligible(uuid) from public;
revoke all on function public.edge_api_complete_daily(uuid, date) from public;
grant execute on function public.edge_api_record_subtopic_completion(uuid, uuid) to service_role;
grant execute on function public.edge_api_award_eligible(uuid) to service_role;
grant execute on function public.edge_api_complete_daily(uuid, date) to service_role;

commit;
