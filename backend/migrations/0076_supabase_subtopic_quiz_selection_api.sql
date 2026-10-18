-- Freeze an optional quiz against one owned immutable subtopic completion.
begin;

create function public.edge_api_subtopic_quiz(p_user_id uuid, p_completion_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_completion record;
  v_quiz_id uuid;
  v_questions jsonb;
  v_public jsonb;
  v_reviewed integer;
  v_required integer;
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
$$;

revoke all on function public.edge_api_subtopic_quiz(uuid,uuid) from public;
grant execute on function public.edge_api_subtopic_quiz(uuid,uuid) to service_role;

commit;
