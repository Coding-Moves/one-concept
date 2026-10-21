-- Account-scoped connection pages expose relationship IDs and current public
-- identity choices, never another account's UUID or email.
begin;

create function public.edge_api_connections(
  p_user_id uuid, p_kind text, p_cursor uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_next uuid;
begin
  if p_kind not in ('accepted', 'incoming', 'outgoing', 'blocked')
     or p_kind is null or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invalid connection page';
  end if;
  if not exists(select 1 from public.profiles where id = p_user_id) then return null; end if;
  with pairs as (
    select c.id,
           case when c.low_user = p_user_id then c.high_user else c.low_user end as peer_id
      from public.connections c
     where (c.low_user = p_user_id or c.high_user = p_user_id)
       and ((p_kind = 'accepted' and c.state = 'accepted')
         or (p_kind = 'incoming' and c.state = 'pending' and c.initiator <> p_user_id)
         or (p_kind = 'outgoing' and c.state = 'pending' and c.initiator = p_user_id))
    union all
    select b.id, b.target_id from public.connection_blocks b
     where p_kind = 'blocked' and b.owner_id = p_user_id
  ), page as (
    select pair.id,
      case when s.enabled and s.show_name
           then coalesce(p.display_name, 'One Concept learner')
           else 'Private learner' end as display_name,
      case when p_kind <> 'blocked' and s.enabled
           then '/p/' || s.public_token else null end as public_path
      from pairs pair
      join public.profiles p on p.id = pair.peer_id
      left join public.profile_sharing s on s.user_id = p.id
     where (p_cursor is null or pair.id > p_cursor)
       and (p_kind = 'blocked' or not exists(
         select 1 from public.connection_blocks b
          where (b.owner_id = p_user_id and b.target_id = pair.peer_id)
             or (b.target_id = p_user_id and b.owner_id = pair.peer_id)
       ))
     order by pair.id limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'display_name', display_name, 'public_path', public_path
  ) order by id), '[]'::jsonb)
    into v_rows from page;
  if jsonb_array_length(v_rows) > p_limit then
    v_next := (v_rows -> (p_limit - 1) ->> 'id')::uuid;
    v_rows := v_rows - p_limit;
  end if;
  return jsonb_build_object('items', v_rows, 'next_cursor', v_next);
end
$$;

revoke all on function public.edge_api_connections(uuid,text,uuid,integer) from public;
grant execute on function public.edge_api_connections(uuid,text,uuid,integer) to service_role;

commit;
