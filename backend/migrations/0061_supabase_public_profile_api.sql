-- Resolve an opt-in public profile with a strict SQL-side allowlist. The
-- wrapper's avatar key/owner are for the Edge signer and are never returned.
begin;

create function public.edge_api_public_profile(p_token text)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_sharing public.profile_sharing%rowtype;
  v_name text;
  v_bio text;
  v_avatar text;
  v_stats jsonb;
  v_achievements jsonb;
  v_profile jsonb;
  v_avatar_key text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select s.* into v_sharing from public.profile_sharing s
   where s.public_token = p_token and s.enabled
   for share of s;
  if not found then return null; end if;
  select p.display_name, p.bio, p.avatar_url
    into v_name, v_bio, v_avatar
    from public.profiles p where p.id = v_sharing.user_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', d.name, 'description', d.description
  ) order by d.sort_order, d.code), '[]'::jsonb)
    into v_achievements
    from public.user_achievements a
    join public.achievement_definitions d on d.code = a.achievement_code
   where a.user_id = v_sharing.user_id
     and a.achievement_code = any(v_sharing.achievement_codes);
  v_profile := jsonb_build_object('achievements', v_achievements);
  if v_sharing.show_name then
    v_profile := v_profile || jsonb_build_object('display_name', coalesce(nullif(v_name, ''), 'Learner'));
  end if;
  if v_sharing.show_bio and v_bio is not null then
    v_profile := v_profile || jsonb_build_object('bio', v_bio);
  end if;
  if v_sharing.show_avatar then
    if v_avatar ~ '^preset:(aurora|comet|forest|ocean|sunset|violet)$' then
      v_profile := v_profile || jsonb_build_object('avatar_ref', v_avatar);
    elsif v_avatar ~ ('^avatars/' || v_sharing.user_id::text || '/[a-f0-9]{32}[.]jpg$') then
      v_avatar_key := v_avatar;
    end if;
  end if;
  if v_sharing.show_streak or v_sharing.show_learning then
    v_stats := public.edge_api_stats(v_sharing.user_id);
    if v_sharing.show_streak then
      v_profile := v_profile || jsonb_build_object(
        'current_streak', v_stats->'current',
        'longest_streak', v_stats->'longest'
      );
    end if;
    if v_sharing.show_learning then
      v_profile := v_profile || jsonb_build_object('concepts_learned', v_stats->'total_learned');
    end if;
  end if;
  return jsonb_build_object(
    'profile', v_profile,
    'avatar_key', v_avatar_key,
    'avatar_owner', case when v_avatar_key is not null then v_sharing.user_id else null end
  );
end
$$;

revoke all on function public.edge_api_public_profile(text) from public;
grant execute on function public.edge_api_public_profile(text) to service_role;

commit;
