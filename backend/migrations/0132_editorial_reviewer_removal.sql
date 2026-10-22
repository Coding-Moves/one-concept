-- A reviewer can leave the private team without deleting their learning account
-- or the immutable evidence of reviews and legacy work they requested.
begin;

alter table public.editorial_legacy_batches
  drop constraint editorial_legacy_batches_requested_by_fkey;
alter table public.editorial_legacy_batches
  add constraint editorial_legacy_batches_requested_by_fkey
  foreign key (requested_by) references auth.users(id) on delete restrict;

alter table public.editorial_account_events
  drop constraint editorial_account_events_action_check;
alter table public.editorial_account_events
  add constraint editorial_account_events_action_check check (action in (
    'bootstrap','invite','profile_requested','profile_approved','access_changed',
    'notification_policy','notification_timezone','notification_retry',
    'authenticator_choice','reviewer_removed'
  ));

create function public.edge_api_editorial_reviewer_remove(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_subject_id uuid, p_expected_version integer
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_subject public.editorial_memberships%rowtype;
  v_another boolean;
  v_unassigned integer;
begin
  if p_subject_id is null or p_expected_version is null or p_expected_version<1 then
    return jsonb_build_object('error','invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  if p_subject_id=p_user_id then return jsonb_build_object('error','self_removal'); end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  perform pg_catalog.pg_advisory_xact_lock(279,263);
  select * into v_subject from public.editorial_memberships
    where user_id=p_subject_id for update;
  if not found then return jsonb_build_object('error','reviewer_not_found'); end if;
  if v_subject.version<>p_expected_version then
    return jsonb_build_object('error','version_conflict');
  end if;
  if v_subject.status='active' and 'manage_reviewers'=any(v_subject.capabilities) then
    select exists(select 1 from public.editorial_memberships m
      join auth.users u on u.id=m.user_id
      where m.user_id<>p_subject_id and m.status='active'
        and m.approved_name is not null
        and 'manage_reviewers'=any(m.capabilities)
        and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=pg_catalog.statement_timestamp()))
      into v_another;
    if not v_another then return jsonb_build_object('error','last_admin'); end if;
  end if;
  update public.concept_revisions set assigned_to=null,review_due_at=null,
    review_assigned_at=null
    where assigned_to=p_subject_id and status not in ('published','retired');
  get diagnostics v_unassigned = row_count;
  update public.editorial_notification_outbox set suppressed=true
    where recipient_id=p_subject_id and batch_id is null and not suppressed;
  delete from public.editorial_memberships where user_id=p_subject_id;
  insert into public.editorial_account_events(actor_id,subject_id,action,details)
    values(p_user_id,p_subject_id,'reviewer_removed',jsonb_build_object(
      'previous_status',v_subject.status,
      'previous_capabilities',v_subject.capabilities,
      'previous_version',v_subject.version,
      'unassigned_count',v_unassigned));
  return jsonb_build_object('removed_user_id',p_subject_id,
    'unassigned_count',v_unassigned);
end
$$;

revoke all on function public.edge_api_editorial_reviewer_remove(
  uuid,uuid,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_reviewer_remove(
  uuid,uuid,text,uuid,integer) to service_role;

commit;
