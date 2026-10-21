-- Recheck current editorial authority inside each privileged read.
begin;

create function public.edge_api_editorial_authorize(
  p_user_id uuid, p_session_id uuid, p_aal text, p_capability text
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
  if p_capability is not null then
    if not (v_member -> 'capabilities' ? p_capability) then
      return jsonb_build_object('error', 'permission');
    end if;
    if v_member ->> 'approved_name' is null then
      return jsonb_build_object('error', 'profile_required');
    end if;
    if (v_member ->> 'require_mfa')::boolean and p_aal is distinct from 'aal2' then
      return jsonb_build_object('error', 'mfa_required');
    end if;
  end if;
  return v_member;
end
$$;

create function public.edge_api_editorial_reviewers(
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
  v_actor := public.edge_api_editorial_authorize(
    p_user_id, p_session_id, p_aal, 'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  with page as (
    select m.user_id, to_jsonb(m) as member
      from public.editorial_memberships m
     where p_cursor is null or m.user_id > p_cursor
     order by m.user_id
     limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over(order by user_id) as position from page
  )
  select coalesce(jsonb_agg(member order by user_id)
           filter(where position <= p_limit), '[]'::jsonb),
         (select user_id from numbered where position = p_limit
           and exists(select 1 from numbered where position > p_limit))
    into v_items, v_next from numbered;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

revoke all on function public.edge_api_editorial_authorize(uuid,uuid,text,text) from public;
revoke all on function public.edge_api_editorial_reviewers(uuid,uuid,text,uuid,integer) from public;
grant execute on function public.edge_api_editorial_authorize(uuid,uuid,text,text) to service_role;
grant execute on function public.edge_api_editorial_reviewers(uuid,uuid,text,uuid,integer) to service_role;

commit;
