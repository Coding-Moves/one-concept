-- Change only the verified account's private avatar reference. Storage writes
-- happen first in Edge; this transaction returns the old key for safe cleanup.
begin;

create function public.edge_api_set_avatar(
  p_user_id uuid, p_avatar_key text, p_compact boolean, p_today date default null
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_old text;
  v_prefix text;
begin
  if p_user_id is null or p_compact is null then
    return jsonb_build_object('error','invalid');
  end if;
  v_prefix := 'avatars/'||p_user_id::text||'/';
  if p_avatar_key is not null and
    (left(p_avatar_key,length(v_prefix))<>v_prefix or
      substring(p_avatar_key from length(v_prefix)+1) !~ '^[a-f0-9]{32}[.]jpg$') then
    return jsonb_build_object('error','invalid');
  end if;
  select avatar_url into v_old from public.profiles
    where id=p_user_id for update;
  if not found then return null; end if;
  update public.profiles set avatar_url=p_avatar_key where id=p_user_id;
  return jsonb_build_object(
    'state',public.edge_api_profile_snapshot(p_user_id,p_compact,p_today),
    'old_avatar_ref',v_old);
end
$$;

revoke all on function public.edge_api_set_avatar(uuid,text,boolean,date)
  from public,anon,authenticated;
grant execute on function public.edge_api_set_avatar(uuid,text,boolean,date)
  to service_role;

commit;
