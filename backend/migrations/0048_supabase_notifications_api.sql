-- Candidate notification preferences and device-token API for Edge Functions.
-- All functions are service-role-only; the handler supplies the verified UID.
begin;

create function public.edge_api_notifications(p_user_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', n.enabled,
    'weekly_quiz_enabled', n.weekly_quiz_enabled,
    'reminder_times', (
      select to_jsonb(array_agg(to_char(value, 'HH24:MI') order by value))
      from unnest(n.reminder_times) value
    )
  )
  from public.notification_preferences n
  where n.user_id = p_user_id
$$;

create function public.edge_api_set_notifications(
  p_user_id uuid, p_enabled boolean, p_weekly boolean, p_times text[]
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_times time[];
begin
  if p_enabled is null or p_times is null or cardinality(p_times) not between 1 and 3
     or exists (
       select 1 from unnest(p_times) value
       where value is null or value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     ) then
    raise exception 'Invalid notification preferences';
  end if;
  select array_agg(distinct value::time order by value::time) into v_times
  from unnest(p_times) value;
  update public.notification_preferences
     set enabled = p_enabled,
         weekly_quiz_enabled = coalesce(p_weekly, weekly_quiz_enabled),
         reminder_times = v_times
   where user_id = p_user_id;
  return public.edge_api_notifications(p_user_id);
end
$$;

create function public.edge_api_push_token(
  p_user_id uuid, p_token text, p_platform text, p_register boolean
)
returns boolean
language plpgsql volatile
set search_path = ''
as $$
begin
  if p_register is null then
    raise exception 'Invalid push-token action';
  end if;
  if p_register then
    if p_token is null or length(p_token) not between 10 and 200
       or (p_platform is not null and p_platform not in ('ios', 'android')) then
      raise exception 'Invalid push token';
    end if;
    insert into public.device_tokens(user_id, expo_push_token, platform)
    values(p_user_id, p_token, p_platform)
    on conflict (expo_push_token) do update
      set user_id = excluded.user_id,
          platform = coalesce(excluded.platform, device_tokens.platform),
          last_seen_at = now();
  elsif p_token is null then
    delete from public.device_tokens where user_id = p_user_id;
  else
    delete from public.device_tokens
    where user_id = p_user_id and expo_push_token = p_token;
  end if;
  return true;
end
$$;

revoke all on function public.edge_api_notifications(uuid) from public;
revoke all on function public.edge_api_set_notifications(uuid, boolean, boolean, text[]) from public;
revoke all on function public.edge_api_push_token(uuid, text, text, boolean) from public;
grant execute on function public.edge_api_notifications(uuid) to service_role;
grant execute on function public.edge_api_set_notifications(uuid, boolean, boolean, text[]) to service_role;
grant execute on function public.edge_api_push_token(uuid, text, text, boolean) to service_role;

commit;
