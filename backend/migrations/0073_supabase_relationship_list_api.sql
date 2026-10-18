-- Private directed list with current public choices and stable cursor order.
begin;

create function public.edge_api_relationships(
  p_user_id uuid, p_cursor_at timestamptz, p_cursor_id uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_next text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
     or (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid relationship page';
  end if;
  if not exists(select 1 from public.profiles where id = p_user_id) then return null; end if;
  with page as (
    select r.id, r.created_at,
      case when s.enabled and s.show_name
           then coalesce(p.display_name, 'One Concept learner')
           else 'Private learner' end as display_name,
      case when s.enabled then '/p/' || s.public_token else null end as public_path,
      case when s.enabled and s.show_avatar and p.avatar_url ~
             '^preset:(aurora|comet|forest|ocean|sunset|violet)$'
           then p.avatar_url else null end as avatar_ref,
      case when s.enabled and s.show_avatar and p.avatar_url ~
             ('^avatars/' || p.id::text || '/[a-f0-9]{32}[.]jpg$')
           then p.avatar_url else null end as avatar_key,
      p.id as avatar_owner
      from public.profile_connections r
      join public.profiles p on p.id = r.target_user_id
      left join public.profile_sharing s on s.user_id = p.id
     where r.source_user_id = p_user_id
       and (p_cursor_at is null or (r.created_at, r.id) < (p_cursor_at, p_cursor_id))
       and not exists(
         select 1 from public.connection_blocks b
          where (b.owner_id = p_user_id and b.target_id = r.target_user_id)
             or (b.owner_id = r.target_user_id and b.target_id = p_user_id)
       )
     order by r.created_at desc, r.id desc
     limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'display_name', display_name, 'public_path', public_path,
    'avatar_ref', avatar_ref, 'avatar_key', avatar_key,
    'avatar_owner', case when avatar_key is not null then avatar_owner else null end,
    'sort_time', to_char(created_at at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) order by created_at desc, id desc), '[]'::jsonb)
    into v_rows from page;
  if jsonb_array_length(v_rows) > p_limit then
    v_next := (v_rows -> (p_limit - 1) ->> 'sort_time') || ':' ||
              (v_rows -> (p_limit - 1) ->> 'id');
    v_rows := v_rows - p_limit;
  end if;
  return jsonb_build_object('items', v_rows, 'next_cursor', v_next);
end
$$;

revoke all on function public.edge_api_relationships(uuid,timestamptz,uuid,integer) from public;
grant execute on function public.edge_api_relationships(uuid,timestamptz,uuid,integer)
  to service_role;

commit;
