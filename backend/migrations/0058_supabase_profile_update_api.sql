-- Keep profile edits atomic, validate server timezone names, and return a
-- profile snapshot without selecting a new daily lesson.
begin;

create function public.edge_api_patch_profile(
  p_user_id uuid, p_display_name text, p_has_bio boolean, p_bio text,
  p_avatar_preset text, p_timezone text, p_initialize_timezone boolean,
  p_compact boolean, p_today date default null
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_old_avatar text;
  v_canonical_timezone text;
begin
  if p_has_bio is null or p_initialize_timezone is null or p_compact is null
     or (p_avatar_preset is not null and p_avatar_preset not in
       ('aurora', 'comet', 'forest', 'ocean', 'sunset', 'violet')) then
    raise exception 'Invalid profile update';
  end if;
  select avatar_url into v_old_avatar from public.profiles
   where id = p_user_id for update;
  if not found then return null; end if;

  if p_timezone is not null then
    select name into v_canonical_timezone from pg_catalog.pg_timezone_names
     where lower(name) = lower(p_timezone) limit 1;
    if v_canonical_timezone is null then
      return jsonb_build_object('error', 'unknown_timezone');
    end if;
  end if;

  update public.profiles
     set display_name = coalesce(p_display_name, display_name),
         bio = case when p_has_bio then p_bio else bio end,
         avatar_url = case when p_avatar_preset is not null
           then 'preset:' || p_avatar_preset else avatar_url end,
         timezone = case when p_timezone is not null
           and (not p_initialize_timezone or not timezone_initialized)
           then v_canonical_timezone else timezone end,
         timezone_initialized = case when p_timezone is not null
           and (not p_initialize_timezone or not timezone_initialized)
           then true else timezone_initialized end
   where id = p_user_id;

  return jsonb_build_object(
    'state', public.edge_api_profile_snapshot(p_user_id, p_compact, p_today),
    'old_avatar_ref', case when p_avatar_preset is not null then v_old_avatar else null end
  );
end
$$;

revoke all on function public.edge_api_patch_profile(
  uuid, text, boolean, text, text, text, boolean, boolean, date
) from public;
grant execute on function public.edge_api_patch_profile(
  uuid, text, boolean, text, text, text, boolean, boolean, date
) to service_role;

commit;
