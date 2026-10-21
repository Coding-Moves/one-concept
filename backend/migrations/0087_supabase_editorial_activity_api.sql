-- Owner activity pages retain the backend's topic filter and cursor semantics.
begin;

create function public.edge_api_editorial_activity(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_cursor uuid, p_topic_id uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    return jsonb_build_object('error', 'invalid_page');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id, p_session_id, p_aal, 'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  with page as (
    select e.id, to_jsonb(e) as item from public.editorial_workflow_events e
     where (p_cursor is null or e.id > p_cursor)
       and (p_topic_id is null or e.topic_id = p_topic_id)
     order by e.id limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over(order by id) as position from page
  )
  select coalesce(jsonb_agg(item order by id) filter(where position <= p_limit), '[]'::jsonb),
         (select id from numbered where position = p_limit
           and exists(select 1 from numbered where position > p_limit))
    into v_items, v_next from numbered;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

revoke all on function public.edge_api_editorial_activity(uuid,uuid,text,uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_activity(uuid,uuid,text,uuid,uuid,integer)
  to service_role;

commit;
