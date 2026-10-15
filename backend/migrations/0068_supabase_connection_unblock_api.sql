-- Only a block's owner can remove it; repeated deletes are harmless.
begin;

create function public.edge_api_connection_unblock(p_user_id uuid, p_block_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_peer uuid;
begin
  if p_block_id is null then return jsonb_build_object('ok', true); end if;
  select target_id into v_peer from public.connection_blocks
   where id = p_block_id and owner_id = p_user_id;
  if v_peer is null then return jsonb_build_object('ok', true); end if;
  perform 1 from public.profiles
   where id in (p_user_id, v_peer) order by id for update;
  delete from public.connection_blocks
   where id = p_block_id and owner_id = p_user_id;
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.edge_api_connection_unblock(uuid,uuid) from public;
grant execute on function public.edge_api_connection_unblock(uuid,uuid) to service_role;

commit;
