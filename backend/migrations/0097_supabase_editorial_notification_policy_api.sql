-- Owner-only, versioned policy changes preserve account/catalog/notification locks.
begin;

create function public.edge_api_editorial_notification_policy(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_expected_version integer, p_deadline_hours integer,
  p_reminder_hours integer, p_max_reminders integer
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_version integer;
  v_result jsonb;
begin
  if p_expected_version is null or p_expected_version < 1
    or p_deadline_hours is null or p_deadline_hours not between 1 and 720
    or p_reminder_hours is null or p_reminder_hours not between 1 and 168
    or p_max_reminders is null or p_max_reminders not between 0 and 10 then
    return jsonb_build_object('error','invalid_policy');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  perform pg_catalog.pg_advisory_xact_lock(279,263);
  select version into v_version from public.editorial_notification_policy
    where singleton for update;
  if v_version is distinct from p_expected_version then
    return jsonb_build_object('error','policy_conflict');
  end if;
  update public.editorial_notification_policy set version=version+1,
    deadline_hours=p_deadline_hours,reminder_hours=p_reminder_hours,
    max_reminders=p_max_reminders where singleton;
  insert into public.editorial_account_events(actor_id,subject_id,action,details)
  values(p_user_id,p_user_id,'notification_policy',jsonb_build_object(
    'deadline_hours',p_deadline_hours,'reminder_hours',p_reminder_hours,
    'max_reminders',p_max_reminders));
  select to_jsonb(p) into v_result from public.editorial_notification_policy p
    where singleton;
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_notification_policy(
  uuid,uuid,text,integer,integer,integer,integer
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_notification_policy(
  uuid,uuid,text,integer,integer,integer,integer
) to service_role;

commit;
