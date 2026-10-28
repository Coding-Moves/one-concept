-- Existing unconfirmed Auth identities still need an invitation email and setup link.
begin;

create or replace function public.edge_api_editorial_invite_prepare(
  p_user_id uuid, p_session_id uuid, p_aal text, p_email text
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_count bigint;
  v_identity uuid;
  v_confirmed_at timestamptz;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  if p_email is null or length(p_email)>254 or p_email<>lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('error','invalid');
  end if;
  select count(*),min(id::text)::uuid,min(email_confirmed_at)
    into v_count,v_identity,v_confirmed_at from auth.users
    where lower(email)=p_email;
  if v_count>1 then return jsonb_build_object('error','duplicate_identity'); end if;
  if v_identity is not null and exists(select 1 from public.editorial_memberships
    where user_id=v_identity) then
    return jsonb_build_object('error','reviewer_exists');
  end if;
  if (select count(*) from public.editorial_memberships where status='active')>=10 then
    return jsonb_build_object('error','team_full');
  end if;
  return jsonb_build_object('user_id',v_identity,
    'needs_invite',v_confirmed_at is null);
end
$$;

commit;
