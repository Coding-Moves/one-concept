-- Score only the frozen private snapshot and append an immutable attempt.
begin;

create function public.edge_api_submit_weekly_quiz(
  p_user_id uuid, p_quiz_id uuid, p_answers jsonb
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_quiz record;
  v_results jsonb;
  v_correct integer;
  v_attempt record;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then return null; end if;
  select id, week_start, questions into v_quiz from public.weekly_quizzes
   where id = p_quiz_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'unavailable'); end if;
  if jsonb_typeof(p_answers) is distinct from 'array'
     or jsonb_array_length(p_answers) <> 7 then
    return jsonb_build_object('error', 'invalid');
  end if;
  if exists(select 1 from jsonb_array_elements(p_answers) a
    where jsonb_typeof(a) is distinct from 'object'
       or jsonb_typeof(a -> 'question_id') is distinct from 'string'
       or length(a ->> 'question_id') not between 1 and 200
       or jsonb_typeof(a -> 'selected_index') is distinct from 'number'
       or (a ->> 'selected_index') !~ '^[0-3]$')
     or (select count(distinct a ->> 'question_id') from jsonb_array_elements(p_answers) a) <> 7
     or exists(select 1 from jsonb_array_elements(v_quiz.questions) q
       where not exists(select 1 from jsonb_array_elements(p_answers) a
         where a ->> 'question_id' = q ->> 'id')) then
    return jsonb_build_object('error', 'invalid');
  end if;
  select jsonb_agg(jsonb_build_object(
    'question_id', q.value ->> 'id',
    'selected_index', (a.value ->> 'selected_index')::integer,
    'correct_index', (q.value ->> 'correct_index')::integer,
    'correct', (a.value ->> 'selected_index')::integer = (q.value ->> 'correct_index')::integer
  ) order by q.ordinality),
    count(*) filter(where (a.value ->> 'selected_index')::integer =
                          (q.value ->> 'correct_index')::integer)::integer
    into v_results, v_correct
    from jsonb_array_elements(v_quiz.questions) with ordinality q(value, ordinality)
    join jsonb_array_elements(p_answers) a(value)
      on a.value ->> 'question_id' = q.value ->> 'id';
  insert into public.weekly_quiz_attempts(quiz_id, user_id, answers, correct_count)
  values(p_quiz_id, p_user_id,
    (select jsonb_agg(jsonb_build_object(
      'question_id', r ->> 'question_id', 'selected_index', r -> 'selected_index'))
       from jsonb_array_elements(v_results) r), v_correct)
  returning id, attempted_at into v_attempt;
  perform public.edge_api_award_eligible(p_user_id);
  return jsonb_build_object('attempt_id', v_attempt.id, 'quiz_id', p_quiz_id,
    'week_start', v_quiz.week_start, 'attempted_at', v_attempt.attempted_at,
    'correct_count', v_correct, 'results', v_results);
end
$$;

revoke all on function public.edge_api_submit_weekly_quiz(uuid,uuid,jsonb) from public;
grant execute on function public.edge_api_submit_weekly_quiz(uuid,uuid,jsonb) to service_role;

commit;
