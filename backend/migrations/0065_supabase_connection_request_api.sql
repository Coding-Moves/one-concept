-- A connection request is serialized with the same pair and rate limits as FastAPI.
begin;

create function public.edge_api_connection_request(p_user_id uuid, p_token text)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_peer uuid;
  v_current uuid;
  v_pair public.connections%rowtype;
  v_cooldown integer;
  v_sharing boolean;
  v_accepting boolean;
  v_count integer;
  v_peer_pending integer;
  v_own_pending integer;
  v_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('error', 'unavailable');
  end if;
  select user_id into v_peer from public.profile_sharing
   where public_token = p_token and enabled;
  if v_peer is null then return jsonb_build_object('error', 'unavailable'); end if;
  -- Lock both profiles in a stable order. This serializes pair actions and
  -- every sender's 24-hour/request-pending counters.
  perform 1 from public.profiles
   where id in (p_user_id, v_peer) order by id for update;
  if not exists(select 1 from public.profiles where id = p_user_id) then
    return null;
  end if;
  select user_id into v_current from public.profile_sharing
   where public_token = p_token and enabled for share;
  if v_current is distinct from v_peer or exists(
    select 1 from public.connection_blocks
     where (owner_id = p_user_id and target_id = v_peer)
        or (owner_id = v_peer and target_id = p_user_id)
  ) then
    return jsonb_build_object('error', 'unavailable');
  end if;
  if p_user_id = v_peer then return jsonb_build_object('error', 'self'); end if;
  select * into v_pair from public.connections
   where low_user = least(p_user_id, v_peer)
     and high_user = greatest(p_user_id, v_peer);
  if v_pair.state = 'accepted' then
    return jsonb_build_object('state', 'accepted', 'id', v_pair.id, 'retry_after', null);
  end if;
  if v_pair.state = 'pending' then
    if v_pair.initiator <> p_user_id then
      return jsonb_build_object('error', 'incoming');
    end if;
    return jsonb_build_object('state', 'outgoing', 'id', v_pair.id, 'retry_after', null);
  end if;
  if v_pair.state in ('declined', 'canceled', 'removed') then
    v_cooldown := greatest(0, ceil(extract(epoch from
      (v_pair.changed_at + interval '7 days' - now())))::integer);
    if v_cooldown > 0 then
      return jsonb_build_object('error', 'cooldown', 'retry_after', v_cooldown);
    end if;
  end if;
  select enabled into v_sharing from public.profile_sharing
   where user_id = p_user_id for share;
  select accepting_requests into v_accepting from public.connection_preferences
   where user_id = v_peer for share;
  if not coalesce(v_sharing, false) or not coalesce(v_accepting, false) then
    return jsonb_build_object('error', 'unavailable');
  end if;
  select count(*) into v_count from public.connection_request_events
   where user_id = p_user_id and requested_at > now() - interval '24 hours';
  select count(*) into v_peer_pending from public.connections
   where state = 'pending' and (low_user = v_peer or high_user = v_peer);
  select count(*) into v_own_pending from public.connections
   where state = 'pending' and (low_user = p_user_id or high_user = p_user_id);
  if v_count >= 20 or v_peer_pending >= 100 or v_own_pending >= 100 then
    return jsonb_build_object('error', 'limit', 'retry_after', 86400);
  end if;
  insert into public.connections(low_user, high_user, initiator, state)
  values (least(p_user_id, v_peer), greatest(p_user_id, v_peer), p_user_id, 'pending')
  on conflict(low_user, high_user) do update
    set id = gen_random_uuid(), initiator = p_user_id, state = 'pending',
        requested_at = now(), changed_at = now()
  returning id into v_id;
  insert into public.connection_request_events(user_id) values (p_user_id);
  delete from public.connection_request_events
   where user_id = p_user_id and requested_at <= now() - interval '24 hours';
  return jsonb_build_object('state', 'outgoing', 'id', v_id, 'retry_after', null);
end
$$;

revoke all on function public.edge_api_connection_request(uuid,text) from public;
grant execute on function public.edge_api_connection_request(uuid,text) to service_role;

commit;
