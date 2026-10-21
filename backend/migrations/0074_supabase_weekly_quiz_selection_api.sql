-- Freeze one reviewed question from seven completed concepts per ISO week.
begin;

create function public.edge_api_weekly_quiz(p_user_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_week date := current_date - (extract(isodow from current_date)::integer - 1);
  v_quiz_id uuid;
  v_questions jsonb;
  v_public jsonb;
  v_count integer;
begin
  if not exists(select 1 from auth.users where id = p_user_id) then return null; end if;
  with created as (
    insert into public.profiles(id, display_name)
    select p_user_id, split_part(u.email, '@', 1) from auth.users u
     where u.id = p_user_id
    on conflict(id) do nothing returning id
  )
  insert into public.user_topics(user_id, topic_id)
  select created.id, t.id from created cross join public.topics t where t.is_active
  on conflict do nothing;
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
$$;

revoke all on function public.edge_api_weekly_quiz(uuid) from public;
grant execute on function public.edge_api_weekly_quiz(uuid) to service_role;

commit;
