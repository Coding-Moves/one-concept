-- Editorial identity comes from an Auth-verified access token plus a current
-- server-side session and membership, never from editable Auth metadata.
begin;

create function public.edge_api_editorial_me(
  p_user_id uuid, p_session_id uuid, p_aal text
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_member public.editorial_memberships%rowtype;
begin
  if p_session_id is null or not exists(
    select 1 from auth.users u join auth.sessions s on s.user_id = u.id
     where u.id = p_user_id and s.id = p_session_id
       and u.email_confirmed_at is not null
       and (u.banned_until is null or u.banned_until <= statement_timestamp())
       and (s.not_after is null or s.not_after > statement_timestamp())
  ) then
    return jsonb_build_object('error', 'session_required');
  end if;
  select * into v_member from public.editorial_memberships
   where user_id = p_user_id and status = 'active';
  if not found then return jsonb_build_object('error', 'unavailable'); end if;
  return jsonb_build_object(
    'member', to_jsonb(v_member),
    'onboarding_required', v_member.requested_name is null,
    'name_approval_pending', v_member.requested_name is distinct from v_member.approved_name,
    'mfa_required', v_member.require_mfa and p_aal is distinct from 'aal2'
  );
end
$$;

revoke all on function public.edge_api_editorial_me(uuid,uuid,text) from public;
grant execute on function public.edge_api_editorial_me(uuid,uuid,text) to service_role;

commit;
