-- A shared-profile block removes both legacy and directed connections atomically.
begin;

create function public.edge_api_connection_block_token(p_user_id uuid, p_token text)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_peer uuid;
  v_current uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('error', 'unavailable');
  end if;
  select user_id into v_peer from public.profile_sharing
   where public_token = p_token and enabled;
  if v_peer is null then return jsonb_build_object('error', 'unavailable'); end if;
  perform 1 from public.profiles
   where id in (p_user_id, v_peer) order by id for update;
  if not exists(select 1 from public.profiles where id = p_user_id) then return null; end if;
  select user_id into v_current from public.profile_sharing
   where public_token = p_token and enabled for share;
  if v_current is distinct from v_peer or exists(
    select 1 from public.connection_blocks
     where (owner_id = p_user_id and target_id = v_peer)
        or (owner_id = v_peer and target_id = p_user_id)
  ) then return jsonb_build_object('error', 'unavailable'); end if;
  if p_user_id = v_peer then return jsonb_build_object('error', 'self'); end if;
  insert into public.connection_blocks(owner_id, target_id)
  values (p_user_id, v_peer)
  on conflict(owner_id, target_id) do nothing;
  update public.connections set state = 'removed', changed_at = now()
   where low_user = least(p_user_id, v_peer)
     and high_user = greatest(p_user_id, v_peer)
     and state in ('pending', 'accepted');
  delete from public.profile_connections
   where (source_user_id = p_user_id and target_user_id = v_peer)
      or (source_user_id = v_peer and target_user_id = p_user_id);
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.edge_api_connection_block_token(uuid,text) from public;
grant execute on function public.edge_api_connection_block_token(uuid,text) to service_role;

commit;
