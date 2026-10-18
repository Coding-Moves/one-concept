-- Bounded private attempt history for one owned completed subtopic.
begin;

create function public.edge_api_subtopic_quiz_attempts(p_user_id uuid, p_completion_id uuid)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if not exists(select 1 from public.user_subtopic_completions
    where id = p_completion_id and user_id = p_user_id) then
    return jsonb_build_object('error', 'unavailable');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attempt_id', page.id, 'attempted_at', page.attempted_at,
    'correct_count', page.correct_count, 'question_count', page.question_count
  ) order by page.attempted_at desc, page.id desc), '[]'::jsonb)
    into v_items from (
      select a.id, a.attempted_at, a.correct_count,
        jsonb_array_length(q.questions) as question_count
        from public.subtopic_quiz_attempts a
        join public.subtopic_quizzes q on q.id = a.quiz_id and q.user_id = a.user_id
       where q.user_id = p_user_id and q.subtopic_completion_id = p_completion_id
       order by a.attempted_at desc, a.id desc
       limit 50
    ) page;
  return jsonb_build_object('items', v_items);
end
$$;

revoke all on function public.edge_api_subtopic_quiz_attempts(uuid,uuid) from public;
grant execute on function public.edge_api_subtopic_quiz_attempts(uuid,uuid) to service_role;

commit;
