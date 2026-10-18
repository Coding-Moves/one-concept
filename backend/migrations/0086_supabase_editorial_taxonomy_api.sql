-- A private taxonomy page is available to any active editor with read rights.
begin;

create function public.edge_api_editorial_authorize_any(
  p_user_id uuid, p_session_id uuid, p_aal text, p_capabilities text[]
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_context jsonb;
  v_member jsonb;
begin
  v_context := public.edge_api_editorial_me(p_user_id, p_session_id, p_aal);
  if v_context ? 'error' then return v_context; end if;
  v_member := v_context -> 'member';
  if p_capabilities is null or not (v_member -> 'capabilities' ?| p_capabilities) then
    return jsonb_build_object('error', 'permission');
  end if;
  if v_member ->> 'approved_name' is null then
    return jsonb_build_object('error', 'profile_required');
  end if;
  if (v_member ->> 'require_mfa')::boolean and p_aal is distinct from 'aal2' then
    return jsonb_build_object('error', 'mfa_required');
  end if;
  return v_member;
end
$$;

create function public.edge_api_editorial_taxonomy(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_cursor uuid, p_limit integer
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
  v_actor := public.edge_api_editorial_authorize_any(
    p_user_id, p_session_id, p_aal, array['review','approve','publish']);
  if v_actor ? 'error' then return v_actor; end if;
  with page as (
    select s.id, jsonb_build_object(
      'id', s.id, 'name', s.name, 'is_active', s.is_active,
      'topic_id', t.id, 'topic_name', t.name, 'topic_active', t.is_active
    ) as item
      from public.subtopics s join public.topics t on t.id = s.topic_id
     where p_cursor is null or s.id > p_cursor
     order by s.id limit p_limit + 1
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

revoke all on function public.edge_api_editorial_authorize_any(uuid,uuid,text,text[])
  from public, anon, authenticated;
revoke all on function public.edge_api_editorial_taxonomy(uuid,uuid,text,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_authorize_any(uuid,uuid,text,text[])
  to service_role;
grant execute on function public.edge_api_editorial_taxonomy(uuid,uuid,text,uuid,integer)
  to service_role;

commit;
