-- Private, versioned connection invitation choices.
begin;

create function public.edge_api_connection_settings_get(p_user_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'accepting_requests', coalesce(c.accepting_requests, false),
    'version', coalesce(c.version, 0)
  )
  from public.profiles p
  left join public.connection_preferences c on c.user_id = p.id
  where p.id = p_user_id
$$;

create function public.edge_api_connection_settings_put(
  p_user_id uuid, p_accepting boolean, p_version integer
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_accepting boolean;
  v_version integer;
begin
  if p_accepting is null or p_version is null or p_version < 0 then
    raise exception 'Invalid connection settings';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then return null; end if;
  insert into public.connection_preferences(user_id) values (p_user_id)
  on conflict(user_id) do nothing;
  update public.connection_preferences
     set accepting_requests = p_accepting, version = version + 1
   where user_id = p_user_id and version = p_version
   returning accepting_requests, version into v_accepting, v_version;
  if not found then return jsonb_build_object('error', 'version_conflict'); end if;
  return jsonb_build_object('accepting_requests', v_accepting, 'version', v_version);
end
$$;

revoke all on function public.edge_api_connection_settings_get(uuid) from public;
revoke all on function public.edge_api_connection_settings_put(uuid,boolean,integer) from public;
grant execute on function public.edge_api_connection_settings_get(uuid) to service_role;
grant execute on function public.edge_api_connection_settings_put(uuid,boolean,integer) to service_role;

commit;
