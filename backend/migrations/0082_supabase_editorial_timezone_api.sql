-- Versioned reviewer notification timezone changes use the account mutation lock.
begin;

create function public.edge_api_editorial_notification_timezone(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_expected_version integer, p_timezone text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_current public.editorial_memberships%rowtype;
begin
  if p_expected_version is null or p_expected_version < 1
     or p_timezone is null or length(p_timezone) > 80
     or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    return jsonb_build_object('error', 'unknown_timezone');
  end if;
  v_actor := public.edge_api_editorial_authorize(p_user_id, p_session_id, p_aal, null);
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274, 263);
  v_actor := public.edge_api_editorial_authorize(p_user_id, p_session_id, p_aal, null);
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_current from public.editorial_memberships where user_id = p_user_id for update;
  if v_current.version <> p_expected_version then
    return jsonb_build_object('error', 'version_conflict');
  end if;
  update public.editorial_memberships set notification_timezone = p_timezone,
    version = version + 1, updated_at = now() where user_id = p_user_id;
  insert into public.editorial_account_events(actor_id, subject_id, action, details)
  values(p_user_id, p_user_id, 'notification_timezone',
    jsonb_build_object('timezone', p_timezone));
  return (select to_jsonb(m) from public.editorial_memberships m where m.user_id = p_user_id);
end
$$;

revoke all on function public.edge_api_editorial_notification_timezone(uuid,uuid,text,integer,text) from public;
grant execute on function public.edge_api_editorial_notification_timezone(uuid,uuid,text,integer,text)
  to service_role;

commit;
