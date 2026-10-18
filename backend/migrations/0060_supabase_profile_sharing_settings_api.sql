-- Private, versioned profile-sharing choices. Public profile JSON is separate.
begin;

create function public.edge_api_new_profile_token()
returns text
language sql volatile
set search_path = ''
as $$
  select rtrim(translate(encode(
    decode(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex') ||
    decode(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex'),
    'base64'), '+/', '-_'), '=')
$$;

create function public.edge_api_sharing_get(p_user_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_row public.profile_sharing%rowtype;
begin
  if not exists(select 1 from public.profiles where id = p_user_id) then
    return null;
  end if;
  insert into public.profile_sharing(user_id, public_token)
  values (p_user_id, public.edge_api_new_profile_token())
  on conflict(user_id) do nothing;
  select * into v_row from public.profile_sharing
   where user_id = p_user_id for update;
  return jsonb_build_object(
    'enabled', v_row.enabled, 'show_name', v_row.show_name,
    'show_avatar', v_row.show_avatar, 'show_bio', v_row.show_bio,
    'show_streak', v_row.show_streak, 'show_learning', v_row.show_learning,
    'achievement_codes', to_jsonb(v_row.achievement_codes),
    'version', v_row.version,
    'public_path', case when v_row.enabled then '/p/' || v_row.public_token else null end
  );
end
$$;

create function public.edge_api_sharing_put(
  p_user_id uuid, p_enabled boolean, p_show_name boolean,
  p_show_avatar boolean, p_show_bio boolean, p_show_streak boolean,
  p_show_learning boolean, p_codes text[], p_version integer
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_row public.profile_sharing%rowtype;
  v_codes text[];
  v_unearned text[];
  v_token text;
begin
  if p_enabled is null or p_show_name is null or p_show_avatar is null
     or p_show_bio is null or p_show_streak is null or p_show_learning is null
     or p_codes is null or cardinality(p_codes) > 32
     or array_position(p_codes, null) is not null
     or p_version is null or p_version < 0 then
    raise exception 'Invalid sharing settings';
  end if;
  -- The initial read creates a disabled row and takes its update lock.
  if public.edge_api_sharing_get(p_user_id) is null then return null; end if;
  select * into v_row from public.profile_sharing
   where user_id = p_user_id for update;
  if v_row.version <> p_version then
    return jsonb_build_object('error', 'version_conflict');
  end if;
  select coalesce(array_agg(distinct code order by code), '{}'::text[])
    into v_codes from unnest(p_codes) as selected(code);
  select coalesce(array_agg(code order by code), '{}'::text[])
    into v_unearned from unnest(v_codes) as selected(code)
   where not exists(select 1 from public.user_achievements earned
     where earned.user_id = p_user_id and earned.achievement_code = selected.code);
  if cardinality(v_unearned) > 0 then
    return jsonb_build_object('error', 'unearned_achievements');
  end if;

  v_token := case when v_row.enabled and not p_enabled
    then public.edge_api_new_profile_token() else v_row.public_token end;
  update public.profile_sharing
     set enabled = p_enabled, show_name = p_show_name,
         show_avatar = p_show_avatar, show_bio = p_show_bio,
         show_streak = p_show_streak, show_learning = p_show_learning,
         achievement_codes = v_codes, public_token = v_token,
         version = version + 1
   where user_id = p_user_id;
  return public.edge_api_sharing_get(p_user_id);
end
$$;

revoke all on function public.edge_api_new_profile_token() from public;
revoke all on function public.edge_api_sharing_get(uuid) from public;
revoke all on function public.edge_api_sharing_put(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text[], integer
) from public;
grant execute on function public.edge_api_new_profile_token() to service_role;
grant execute on function public.edge_api_sharing_get(uuid) to service_role;
grant execute on function public.edge_api_sharing_put(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text[], integer
) to service_role;

commit;
