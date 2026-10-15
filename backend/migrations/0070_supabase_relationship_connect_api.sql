-- Saving a shared profile is one directed choice, serialized by profile locks.
begin;

create function public.edge_api_relationship_connect(p_user_id uuid, p_token text)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_peer uuid;
  v_current uuid;
  v_id uuid;
  v_count integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('error', 'unavailable');
  end if;
  select user_id into v_peer from public.profile_sharing
   where public_token = p_token and enabled;
  if v_peer is null or v_peer = p_user_id then
    return jsonb_build_object('error', 'unavailable');
  end if;
  -- The same actor row also serializes the 24-hour rate counter across peers.
  perform 1 from public.profiles
   where id in (p_user_id, v_peer) order by id for update;
  if not exists(select 1 from public.profiles where id = p_user_id) then return null; end if;
  select user_id into v_current from public.profile_sharing
   where public_token = p_token and enabled for share;
  if v_current is distinct from v_peer or exists(
    select 1 from public.connection_blocks
     where (owner_id = p_user_id and target_id = v_peer)
        or (owner_id = v_peer and target_id = p_user_id)
  ) then
    return jsonb_build_object('error', 'unavailable');
  end if;
  select id into v_id from public.profile_connections
   where source_user_id = p_user_id and target_user_id = v_peer;
  if v_id is not null then
    return jsonb_build_object('state', 'connected', 'relationship_id', v_id);
  end if;
  select count(*) into v_count from public.connection_request_events
   where user_id = p_user_id and requested_at > now() - interval '24 hours';
  if v_count >= 40 then
    return jsonb_build_object('error', 'limit', 'retry_after', 86400);
  end if;
  insert into public.profile_connections(source_user_id,target_user_id)
    values (p_user_id,v_peer) returning id into v_id;
  insert into public.connection_request_events(user_id) values (p_user_id);
  delete from public.connection_request_events
   where user_id = p_user_id and requested_at <= now() - interval '24 hours';
  return jsonb_build_object('state', 'connected', 'relationship_id', v_id);
end
$$;

revoke all on function public.edge_api_relationship_connect(uuid,text) from public;
grant execute on function public.edge_api_relationship_connect(uuid,text) to service_role;

commit;
