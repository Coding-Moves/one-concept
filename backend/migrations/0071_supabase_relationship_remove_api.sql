-- Only a directed relationship's owner can remove it; retries are harmless.
begin;

create function public.edge_api_relationship_remove(p_user_id uuid, p_relationship_id uuid)
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
  if v_current = v_peer then
    delete from public.profile_connections
     where id = p_relationship_id and source_user_id = p_user_id;
  end if;
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.edge_api_relationship_remove(uuid,uuid) from public;
grant execute on function public.edge_api_relationship_remove(uuid,uuid) to service_role;

commit;
