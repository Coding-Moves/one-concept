-- A shared profile token gives a caller only the status of its own pair.
begin;

create function public.edge_api_connection_status(p_user_id uuid, p_token text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_peer uuid;
  v_pair public.connections%rowtype;
  v_cooldown integer;
  v_accepting boolean;
  v_sharing boolean;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('state', 'unavailable', 'id', null, 'retry_after', null);
  end if;
  if not exists(select 1 from public.profiles where id = p_user_id) then return null; end if;
  select user_id into v_peer from public.profile_sharing
   where public_token = p_token and enabled;
  if v_peer is null or exists(
    select 1 from public.connection_blocks
     where (owner_id = p_user_id and target_id = v_peer)
        or (owner_id = v_peer and target_id = p_user_id)
  ) then
    return jsonb_build_object('state', 'unavailable', 'id', null, 'retry_after', null);
  end if;
  if p_user_id = v_peer then
    return jsonb_build_object('state', 'self', 'id', null, 'retry_after', null);
  end if;
  select * into v_pair from public.connections
   where low_user = least(p_user_id, v_peer)
     and high_user = greatest(p_user_id, v_peer);
  if v_pair.state = 'accepted' then
    return jsonb_build_object('state', 'accepted', 'id', v_pair.id, 'retry_after', null);
  end if;
  if v_pair.state = 'pending' then
    return jsonb_build_object('state',
      case when v_pair.initiator = p_user_id then 'outgoing' else 'incoming' end,
      'id', v_pair.id, 'retry_after', null);
  end if;
  if v_pair.state in ('declined', 'canceled', 'removed') then
    v_cooldown := greatest(0, ceil(extract(epoch from
      (v_pair.changed_at + interval '7 days' - now())))::integer);
    if v_cooldown > 0 then
      return jsonb_build_object('state', 'cooldown', 'id', null,
        'retry_after', v_cooldown);
    end if;
  end if;
  select accepting_requests into v_accepting from public.connection_preferences
   where user_id = v_peer;
  select enabled into v_sharing from public.profile_sharing
   where user_id = p_user_id;
  return jsonb_build_object('state',
    case when v_accepting and v_sharing then 'available' else 'unavailable' end,
    'id', null, 'retry_after', null);
end
$$;

revoke all on function public.edge_api_connection_status(uuid,text) from public;
grant execute on function public.edge_api_connection_status(uuid,text) to service_role;

commit;
