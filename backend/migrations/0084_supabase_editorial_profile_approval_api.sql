-- A second active administrator approves a reviewer's exact requested name.
begin;

create function public.edge_api_editorial_approve_profile(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_subject_id uuid, p_expected_version integer
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_subject public.editorial_memberships%rowtype;
begin
  if p_subject_id is null or p_expected_version is null or p_expected_version < 1 then
    return jsonb_build_object('error', 'invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id, p_session_id, p_aal, 'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274, 263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id, p_session_id, p_aal, 'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  if p_subject_id = p_user_id then return jsonb_build_object('error', 'self_approval'); end if;
  select * into v_subject from public.editorial_memberships
   where user_id = p_subject_id for update;
  if not found then return jsonb_build_object('error', 'unavailable'); end if;
  if v_subject.version <> p_expected_version then
    return jsonb_build_object('error', 'version_conflict');
  end if;
  if v_subject.status <> 'active' or v_subject.requested_name is null then
    return jsonb_build_object('error', 'request_required');
  end if;
  if v_subject.approved_name is not distinct from v_subject.requested_name then
    return to_jsonb(v_subject);
  end if;
  update public.editorial_memberships set approved_name = requested_name,
    version = version + 1, updated_at = now() where user_id = p_subject_id;
  insert into public.editorial_account_events(actor_id, subject_id, action, details)
  values(p_user_id, p_subject_id, 'profile_approved', jsonb_build_object(
    'previous_approved_name', v_subject.approved_name,
    'approved_name', v_subject.requested_name,
    'version', v_subject.version + 1));
  return (select to_jsonb(m) from public.editorial_memberships m where m.user_id = p_subject_id);
end
$$;

revoke all on function public.edge_api_editorial_approve_profile(uuid,uuid,text,uuid,integer) from public;
grant execute on function public.edge_api_editorial_approve_profile(uuid,uuid,text,uuid,integer)
  to service_role;

commit;
