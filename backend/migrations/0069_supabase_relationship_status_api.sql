-- A shared token reveals only whether the verified caller saved that profile.
begin;

create function public.edge_api_relationship_status(p_user_id uuid, p_token text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_peer uuid;
  v_relationship uuid;
begin
  if not exists(select 1 from public.profiles where id = p_user_id) then return null; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('state', 'unavailable', 'relationship_id', null);
  end if;
  select user_id into v_peer from public.profile_sharing
   where public_token = p_token and enabled;
  if v_peer is null or v_peer = p_user_id or exists(
    select 1 from public.connection_blocks
     where (owner_id = p_user_id and target_id = v_peer)
        or (owner_id = v_peer and target_id = p_user_id)
  ) then
    return jsonb_build_object('state', 'unavailable', 'relationship_id', null);
  end if;
  select id into v_relationship from public.profile_connections
   where source_user_id = p_user_id and target_user_id = v_peer;
  return jsonb_build_object(
    'state', case when v_relationship is null then 'available' else 'connected' end,
    'relationship_id', v_relationship
  );
end
$$;

revoke all on function public.edge_api_relationship_status(uuid,text) from public;
grant execute on function public.edge_api_relationship_status(uuid,text) to service_role;

commit;
