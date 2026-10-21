-- A saved relationship can be blocked after its shared token is revoked.
begin;

create function public.edge_api_relationship_block(p_user_id uuid, p_relationship_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_peer uuid;
  v_current uuid;
begin
  if p_relationship_id is null then return jsonb_build_object('ok', true); end if;
  select target_user_id into v_peer from public.profile_connections
   where id = p_relationship_id and source_user_id = p_user_id;
  if v_peer is null then return jsonb_build_object('ok', true); end if;
  perform 1 from public.profiles
   where id in (p_user_id, v_peer) order by id for update;
  select target_user_id into v_current from public.profile_connections
   where id = p_relationship_id and source_user_id = p_user_id for update;
  if v_current is distinct from v_peer then return jsonb_build_object('ok', true); end if;
  insert into public.connection_blocks(owner_id,target_id)
    values (p_user_id,v_peer) on conflict(owner_id,target_id) do nothing;
  -- Blocking a person removes both directed choices and a legacy invitation.
  delete from public.profile_connections
   where (source_user_id = p_user_id and target_user_id = v_peer)
      or (source_user_id = v_peer and target_user_id = p_user_id);
  delete from public.connections
   where low_user = least(p_user_id,v_peer)
     and high_user = greatest(p_user_id,v_peer);
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.edge_api_relationship_block(uuid,uuid) from public;
grant execute on function public.edge_api_relationship_block(uuid,uuid) to service_role;

commit;
