-- Legacy mutual-request actions serialize by pair and reject stale invitation IDs.
begin;

create function public.edge_api_connection_action(
  p_user_id uuid, p_connection_id uuid, p_action text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_pair public.connections%rowtype;
  v_current public.connections%rowtype;
  v_peer uuid;
  v_target text;
  v_required text;
begin
  if p_action is null or p_action not in ('accept', 'decline', 'cancel', 'remove', 'block')
     or p_connection_id is null then
    return jsonb_build_object('error', 'invalid');
  end if;
  select * into v_pair from public.connections
   where id = p_connection_id and (low_user = p_user_id or high_user = p_user_id);
  if v_pair.id is null then return jsonb_build_object('error', 'unavailable'); end if;
  v_peer := case when v_pair.low_user = p_user_id then v_pair.high_user else v_pair.low_user end;
  perform 1 from public.profiles
   where id in (p_user_id, v_peer) order by id for update;
  select * into v_current from public.connections
   where low_user = least(p_user_id, v_peer)
     and high_user = greatest(p_user_id, v_peer);
  if v_current.id is distinct from p_connection_id then
    return jsonb_build_object('error', 'unavailable');
  end if;
  if p_action = 'block' then
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
  end if;
  if exists(select 1 from public.connection_blocks
    where (owner_id = p_user_id and target_id = v_peer)
       or (owner_id = v_peer and target_id = p_user_id)) then
    return jsonb_build_object('error', 'unavailable');
  end if;
  if p_action in ('accept', 'decline') and v_current.initiator = p_user_id then
    return jsonb_build_object('error', 'recipient_only');
  end if;
  if p_action = 'cancel' and v_current.initiator <> p_user_id then
    return jsonb_build_object('error', 'sender_only');
  end if;
  v_target := case p_action
    when 'accept' then 'accepted' when 'decline' then 'declined'
    when 'cancel' then 'canceled' else 'removed' end;
  if v_current.state = v_target then return jsonb_build_object('ok', true); end if;
  v_required := case when p_action = 'remove' then 'accepted' else 'pending' end;
  if v_current.state <> v_required then return jsonb_build_object('error', 'changed'); end if;
  update public.connections set state = v_target, changed_at = now()
   where id = p_connection_id;
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.edge_api_connection_action(uuid,uuid,text) from public;
grant execute on function public.edge_api_connection_action(uuid,uuid,text) to service_role;

commit;
