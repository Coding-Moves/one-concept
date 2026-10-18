-- Versioned reviewer name requests recheck authority after the account lock.
begin;

create function public.edge_api_editorial_request_profile(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_expected_version integer, p_registered_name text
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
     or p_registered_name is null or length(p_registered_name) not between 2 and 80
     or p_registered_name <> btrim(p_registered_name)
     or p_registered_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('error', 'invalid');
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
  if v_current.requested_name is distinct from p_registered_name then
    update public.editorial_memberships set requested_name = p_registered_name,
      version = version + 1, updated_at = now() where user_id = p_user_id;
    insert into public.editorial_account_events(actor_id, subject_id, action, details)
    values(p_user_id, p_user_id, 'profile_requested', jsonb_build_object(
      'previous_requested_name', v_current.requested_name,
      'requested_name', p_registered_name,
      'approved_name', v_current.approved_name,
      'version', v_current.version + 1));
  end if;
  return (select to_jsonb(m) from public.editorial_memberships m where m.user_id = p_user_id);
end
$$;

revoke all on function public.edge_api_editorial_request_profile(uuid,uuid,text,integer,text) from public;
grant execute on function public.edge_api_editorial_request_profile(uuid,uuid,text,integer,text)
  to service_role;

commit;
