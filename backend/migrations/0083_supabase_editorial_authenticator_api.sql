-- Account MFA choice requires a recent verified TOTP event when disabling.
begin;

create function public.edge_api_editorial_authenticator(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_mfa_verified_at bigint, p_expected_version integer, p_require_mfa boolean
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_current public.editorial_memberships%rowtype;
  v_now numeric;
begin
  if p_expected_version is null or p_expected_version < 1 or p_require_mfa is null then
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
  if v_current.require_mfa = p_require_mfa then return to_jsonb(v_current); end if;
  if not p_require_mfa then
    v_now := extract(epoch from pg_catalog.statement_timestamp());
    if p_aal is distinct from 'aal2' or p_mfa_verified_at is null
       or p_mfa_verified_at < v_now - 300 or p_mfa_verified_at > v_now + 60 then
      return jsonb_build_object('error', 'recent_mfa_required');
    end if;
  end if;
  update public.editorial_memberships set require_mfa = p_require_mfa,
    version = version + 1, updated_at = now() where user_id = p_user_id;
  insert into public.editorial_account_events(actor_id, subject_id, action, details)
  values(p_user_id, p_user_id, 'authenticator_choice', jsonb_build_object(
    'previous_required', v_current.require_mfa,
    'required', p_require_mfa,
    'version', v_current.version + 1));
  return (select to_jsonb(m) from public.editorial_memberships m where m.user_id = p_user_id);
end
$$;

revoke all on function public.edge_api_editorial_authenticator(uuid,uuid,text,bigint,integer,boolean) from public;
grant execute on function public.edge_api_editorial_authenticator(uuid,uuid,text,bigint,integer,boolean)
  to service_role;

commit;
