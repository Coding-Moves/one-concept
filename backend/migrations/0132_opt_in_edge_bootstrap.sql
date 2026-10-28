-- Keep every Edge API first-request path opt-in when the Auth trigger was skipped.
-- Existing follows and the explicit set-topics RPC are untouched.
begin;

-- edge_api_daily: bootstrap profile/preferences without choosing topics.
CREATE OR REPLACE FUNCTION public.edge_api_daily(p_user_id uuid, p_low integer DEFAULT 10, p_reserve integer DEFAULT 60, p_active_days integer DEFAULT 90, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date;
  v_timezone text;
  v_concept uuid;
  v_topic uuid;
  v_assignment uuid;
  v_payload jsonb;
begin
  if p_low < 0 or p_low > 30 or p_reserve < 1 or p_reserve > 365
     or p_active_days < 1 or p_active_days > 365 then
    raise exception 'Invalid supply configuration';
  end if;

  -- Match the legacy-user safety net without restoring deliberately unfollowed topics.
  insert into public.profiles(id, display_name)
  select p_user_id, split_part(u.email, '@', 1)
    from auth.users u where u.id = p_user_id
  on conflict(id) do nothing;
  insert into public.notification_preferences(user_id) values (p_user_id)
  on conflict(user_id) do nothing;

  select timezone into v_timezone
    from public.profiles where id = p_user_id for update;
  if v_timezone is null then
    raise exception 'Profile unavailable';
  end if;
  v_today := coalesce(p_today, (now() at time zone v_timezone)::date);

  if exists(select 1 from public.daily_reviews
    where user_id = p_user_id and assigned_for = v_today) then
    return jsonb_build_object('assigned_for', v_today, 'reason', 'catalog_exhausted',
      'detail', 'You have already been assigned every available concept.');
  end if;
  if exists(select 1 from public.daily_assignments
    where user_id = p_user_id and assigned_for = v_today) then
    v_payload := public.edge_api_daily_payload(p_user_id, v_today);
    if v_payload is not null then return v_payload; end if;
    return jsonb_build_object('assigned_for', v_today, 'reason', 'catalog_exhausted',
      'detail', 'You have already been assigned every available concept.');
  end if;

  if not exists(select 1 from public.user_topics ut
    join public.topics t on t.id = ut.topic_id and t.is_active
    where ut.user_id = p_user_id) then
    return jsonb_build_object('assigned_for', v_today, 'reason', 'personalization_required',
      'detail', 'Follow at least one topic to receive a daily concept.');
  end if;

  -- Move the most recent unfinished followed lesson, retaining its identity and timestamp.
  with pending as (
    select a.id from public.daily_assignments a
    join public.concepts c on c.id = a.concept_id and c.status = 'published'
    join public.topics t on t.id = c.topic_id and t.is_active
    join public.subtopics s on s.id = c.subtopic_id and s.is_active
    join public.user_topics ut on ut.topic_id = c.topic_id and ut.user_id = p_user_id
    where a.user_id = p_user_id and a.completed_at is null and a.assigned_for < v_today
    order by a.assigned_for desc, a.id limit 1
  )
  update public.daily_assignments a set assigned_for = v_today
    from pending where a.id = pending.id returning a.concept_id into v_concept;
  if v_concept is not null then
    select topic_id into v_topic from public.concepts where id = v_concept;
    perform public.edge_api_signal_supply(p_user_id, v_topic, p_low, p_reserve, p_active_days);
    return public.edge_api_daily_payload(p_user_id, v_today);
  end if;

  with pool as (
    select c.id, c.topic_id, coalesce(c.difficulty, 1) as level,
      (select count(*) from jsonb_array_elements_text(
        coalesce(c.curriculum->'prerequisites', '[]'::jsonb)) required(slug)
        where not exists(select 1 from public.daily_assignments learned
          join public.concepts prior on prior.id = learned.concept_id
          where learned.user_id = p_user_id and learned.completed_at is not null
            and prior.slug = required.slug)) as unmet
      from public.concepts c
      join public.topics t on t.id = c.topic_id and t.is_active
      join public.subtopics s on s.id = c.subtopic_id and s.is_active
      where c.status = 'published'
        and exists(select 1 from public.user_topics ut
          where ut.user_id = p_user_id and ut.topic_id = c.topic_id)
        and not exists(select 1 from public.daily_assignments a
          where a.user_id = p_user_id and a.concept_id = c.id)
  ), last_seen as (
    select c.topic_id, max(a.assigned_for) as seen_on
      from public.daily_assignments a
      join public.concepts c on c.id = a.concept_id and c.status = 'published'
     where a.user_id = p_user_id group by c.topic_id
  )
  select pool.id, pool.topic_id into v_concept, v_topic
    from pool left join last_seen on last_seen.topic_id = pool.topic_id
   order by last_seen.seen_on asc nulls first, pool.unmet asc, pool.level asc, random()
   limit 1;

  if v_concept is not null then
    begin
      insert into public.daily_assignments(id, user_id, concept_id, assigned_for)
      values (gen_random_uuid(), p_user_id, v_concept, v_today)
      on conflict(user_id, assigned_for) do nothing returning id into v_assignment;
    exception when unique_violation then
      v_assignment := null;
    end;
    if v_assignment is not null then
      perform public.edge_api_signal_supply(p_user_id, v_topic, p_low, p_reserve, p_active_days);
      v_payload := public.edge_api_daily_payload(p_user_id, v_today);
      if v_payload is not null then return v_payload; end if;
    else
      v_payload := public.edge_api_daily_payload(p_user_id, v_today);
      if v_payload is not null then return v_payload; end if;
    end if;
  else
    -- Request future supply in a followed topic without waiting for generation.
    select ut.topic_id into v_topic from public.user_topics ut
    join public.topics t on t.id = ut.topic_id and t.is_active
    left join (
      select c.topic_id, max(a.assigned_for) as seen_on
      from public.daily_assignments a
      join public.concepts c on c.id = a.concept_id and c.status = 'published'
      where a.user_id = p_user_id group by c.topic_id
    ) seen on seen.topic_id = ut.topic_id
    where ut.user_id = p_user_id
    order by seen.seen_on asc nulls first limit 1;
    if v_topic is not null then
      perform public.edge_api_signal_supply(p_user_id, v_topic, p_low, p_reserve, p_active_days);
    end if;
  end if;
  return jsonb_build_object('assigned_for', v_today, 'reason', 'catalog_exhausted',
    'detail', 'You have already been assigned every available concept.');
end
$function$
;

-- edge_api_achievements: bootstrap profile/preferences without choosing topics.
CREATE OR REPLACE FUNCTION public.edge_api_achievements(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stats jsonb;
  v_existing text[];
  v_items jsonb;
begin
  -- Match first-request bootstrap without creating a daily assignment.
  insert into public.profiles(id, display_name)
  select p_user_id, split_part(u.email, '@', 1)
    from auth.users u where u.id = p_user_id
  on conflict(id) do nothing;
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
$function$
;

-- edge_api_weekly_quiz: bootstrap profile/preferences without choosing topics.
CREATE OR REPLACE FUNCTION public.edge_api_weekly_quiz(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_week date := current_date - (extract(isodow from current_date)::integer - 1);
  v_quiz_id uuid;
  v_questions jsonb;
  v_public jsonb;
  v_count integer;
begin
  if not exists(select 1 from auth.users where id = p_user_id) then return null; end if;
  insert into public.profiles(id, display_name)
  select p_user_id, split_part(u.email, '@', 1)
    from auth.users u where u.id = p_user_id
  on conflict(id) do nothing;
  insert into public.notification_preferences(user_id) values(p_user_id)
  on conflict(user_id) do nothing;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then return null; end if;

  select id, questions into v_quiz_id, v_questions
    from public.weekly_quizzes where user_id = p_user_id and week_start = v_week;
  if v_quiz_id is null then
    with recent as (
      select c.id, c.slug, c.title, c.content_version, c.mcqs,
             max(a.completed_at) as completed_at
        from public.daily_assignments a
        join public.concepts c on c.id = a.concept_id
       where a.user_id = p_user_id and a.completed_at is not null
         and c.status = 'published' and jsonb_typeof(c.mcqs) = 'array'
       group by c.id, c.slug, c.title, c.content_version, c.mcqs
      having jsonb_array_length(c.mcqs) = 3
       order by max(a.completed_at) desc, c.id
       limit 7
    ), selected as (
      select recent.*,
        (get_byte(pg_catalog.sha256(convert_to(
          p_user_id::text || ':' || v_week::text || ':' || recent.id::text, 'UTF8')), 0) * 256
         + get_byte(pg_catalog.sha256(convert_to(
          p_user_id::text || ':' || v_week::text || ':' || recent.id::text, 'UTF8')), 1)) % 3
        as question_index
      from recent
    )
    select count(*)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', id::text || ':' || content_version::text || ':' || question_index::text,
        'concept_slug', slug, 'concept_title', title,
        'content_version', content_version,
        'question', mcqs -> question_index -> 'question',
        'options', mcqs -> question_index -> 'options',
        'correct_index', mcqs -> question_index -> 'correct_index'
      ) order by completed_at desc, id), '[]'::jsonb)
      into v_count, v_questions from selected;
    if v_count < 7 then
      return jsonb_build_object('available', false, 'week_start', v_week,
        'required_concepts', 7, 'available_concepts', v_count,
        'detail', 'Complete more concepts with reviewed questions to unlock this weekly quiz.');
    end if;
    insert into public.weekly_quizzes(user_id, week_start, questions)
    values(p_user_id, v_week, v_questions) returning id into v_quiz_id;
  end if;
  select coalesce(jsonb_agg(q.value - 'correct_index' order by q.ordinality), '[]'::jsonb)
    into v_public from jsonb_array_elements(v_questions) with ordinality as q(value, ordinality);
  return jsonb_build_object('available', true, 'quiz_id', v_quiz_id,
    'week_start', v_week, 'questions', v_public);
end
$function$
;

-- edge_api_subtopic_quiz: bootstrap profile/preferences without choosing topics.
CREATE OR REPLACE FUNCTION public.edge_api_subtopic_quiz(p_user_id uuid, p_completion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_completion record;
  v_quiz_id uuid;
  v_questions jsonb;
  v_public jsonb;
  v_reviewed integer;
  v_required integer;
begin
  if not exists(select 1 from auth.users where id = p_user_id) then return null; end if;
  insert into public.profiles(id, display_name)
  select p_user_id, split_part(u.email, '@', 1)
    from auth.users u where u.id = p_user_id
  on conflict(id) do nothing;
  insert into public.notification_preferences(user_id) values(p_user_id)
  on conflict(user_id) do nothing;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then return null; end if;
  select e.catalog_concept_ids, t.name as topic_name, s.name as subtopic_name
    into v_completion from public.user_subtopic_completions e
    join public.subtopics s on s.id = e.subtopic_id
    join public.topics t on t.id = s.topic_id
   where e.id = p_completion_id and e.user_id = p_user_id;
  if not found then return jsonb_build_object('error', 'unavailable'); end if;
  select id, questions into v_quiz_id, v_questions from public.subtopic_quizzes
   where user_id = p_user_id and subtopic_completion_id = p_completion_id;
  if v_quiz_id is null then
    v_required := least(7, cardinality(v_completion.catalog_concept_ids));
    with candidates as (
      select c.id, c.slug, c.title, c.content_version, c.mcqs,
        pg_catalog.sha256(convert_to(p_completion_id::text || ':select:' || c.id::text, 'UTF8')) as sort_key,
        (get_byte(pg_catalog.sha256(convert_to(
          p_completion_id::text || ':' || c.id::text, 'UTF8')), 0) * 256
         + get_byte(pg_catalog.sha256(convert_to(
          p_completion_id::text || ':' || c.id::text, 'UTF8')), 1)) % 3 as question_index
        from public.concepts c
       where c.id = any(v_completion.catalog_concept_ids)
         and c.status = 'published' and jsonb_typeof(c.mcqs) = 'array'
         and jsonb_array_length(c.mcqs) = 3
       order by sort_key, c.id
       limit v_required
    )
    select count(*)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', id::text || ':' || content_version::text || ':' || question_index::text,
        'concept_slug', slug, 'concept_title', title,
        'content_version', content_version,
        'question', mcqs -> question_index -> 'question',
        'options', mcqs -> question_index -> 'options',
        'correct_index', mcqs -> question_index -> 'correct_index'
      ) order by sort_key, id), '[]'::jsonb)
      into v_reviewed, v_questions from candidates;
    if v_reviewed < v_required then
      return jsonb_build_object('available', false, 'completion_id', p_completion_id,
        'topic_name', v_completion.topic_name, 'subtopic_name', v_completion.subtopic_name,
        'reviewed_concepts', v_reviewed, 'required_concepts', v_required,
        'detail', 'This optional quiz will unlock when enough reviewed questions are available.');
    end if;
    insert into public.subtopic_quizzes(user_id, subtopic_completion_id, questions)
    values(p_user_id, p_completion_id, v_questions) returning id into v_quiz_id;
  end if;
  select coalesce(jsonb_agg(q.value - 'correct_index' order by q.ordinality), '[]'::jsonb)
    into v_public from jsonb_array_elements(v_questions) with ordinality as q(value, ordinality);
  return jsonb_build_object('available', true, 'quiz_id', v_quiz_id,
    'completion_id', p_completion_id, 'topic_name', v_completion.topic_name,
    'subtopic_name', v_completion.subtopic_name, 'questions', v_public);
end
$function$
;

commit;
