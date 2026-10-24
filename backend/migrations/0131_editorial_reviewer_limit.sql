-- Enforce ten active editorial memberships, including the owner.
-- New reviewer invitations start with an optional authenticator.
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
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  if p_email is null or length(p_email)>254 or p_email<>lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('error','invalid');
  end if;
  select count(*),min(id::text)::uuid into v_count,v_identity from auth.users
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
    'needs_invite',v_identity is null);
end
$$;

create or replace function public.edge_api_editorial_invite_finish(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_email text, p_invited_id uuid, p_capabilities text[]
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_caps text[];
  v_count bigint;
begin
  if p_invited_id is null or p_email is null or length(p_email)>254
    or p_email<>lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_capabilities is null or cardinality(p_capabilities)>5
    or array_position(p_capabilities,null) is not null
    or not (p_capabilities <@ array['review','approve','publish',
      'request_generation','manage_reviewers']::text[]) then
    return jsonb_build_object('error','invalid');
  end if;
  select coalesce(array_agg(cap order by cap),array[]::text[]) into v_caps
    from (select distinct unnest(p_capabilities) as cap) dedup;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  select count(*) into v_count from auth.users
    where lower(email)=p_email;
  if v_count>1 then return jsonb_build_object('error','duplicate_identity'); end if;
  if v_count=0 or not exists(select 1 from auth.users
      where id=p_invited_id and lower(email)=p_email) then
    return jsonb_build_object('error','identity_not_ready');
  end if;
  if exists(select 1 from public.editorial_memberships
      where user_id=p_invited_id) then
    return jsonb_build_object('error','reviewer_exists');
  end if;
  if (select count(*) from public.editorial_memberships where status='active')>=10 then
    return jsonb_build_object('error','team_full');
  end if;
  insert into public.editorial_memberships(user_id,invited_email,capabilities,require_mfa)
    values(p_invited_id,p_email,v_caps,false);
  insert into public.editorial_account_events(actor_id,subject_id,action,details)
    values(p_user_id,p_invited_id,'invite',
      jsonb_build_object('capabilities',v_caps));
  return (select to_jsonb(m) from public.editorial_memberships m
    where m.user_id=p_invited_id);
end
$$;

revoke all on function public.edge_api_editorial_invite_prepare(
  uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.edge_api_editorial_invite_finish(
  uuid,uuid,text,text,uuid,text[]) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_invite_prepare(
  uuid,uuid,text,text) to service_role;
grant execute on function public.edge_api_editorial_invite_finish(
  uuid,uuid,text,text,uuid,text[]) to service_role;

create or replace function public.edge_api_editorial_reviewer_access(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_subject_id uuid, p_expected_version integer,
  p_status text, p_capabilities text[]
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_subject public.editorial_memberships%rowtype;
  v_caps text[];
  v_another boolean;
begin
  if p_subject_id is null or p_expected_version is null or p_expected_version<1
    or p_status is null or p_status not in ('active','revoked')
    or p_capabilities is null or cardinality(p_capabilities)>5
    or array_position(p_capabilities,null) is not null
    or not (p_capabilities <@ array['review','approve','publish',
      'request_generation','manage_reviewers']::text[]) then
    return jsonb_build_object('error','invalid');
  end if;
  select coalesce(array_agg(cap order by cap),array[]::text[]) into v_caps
    from (select distinct unnest(p_capabilities) as cap) dedup;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_subject from public.editorial_memberships
    where user_id=p_subject_id for update;
  if not found then return jsonb_build_object('error','unavailable'); end if;
  if v_subject.version<>p_expected_version then
    return jsonb_build_object('error','version_conflict');
  end if;
  if 'manage_reviewers'=any(v_subject.capabilities)
    and v_subject.status='active'
    and (p_status='revoked' or not 'manage_reviewers'=any(v_caps)) then
    select exists(select 1 from public.editorial_memberships m
      join auth.users u on u.id=m.user_id
      where m.user_id<>p_subject_id and m.status='active'
        and m.approved_name is not null
        and 'manage_reviewers'=any(m.capabilities)
        and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())) into v_another;
    if not v_another then return jsonb_build_object('error','last_admin'); end if;
  end if;
  if v_subject.status=p_status and (
    select coalesce(array_agg(distinct cap order by cap),array[]::text[])
      from unnest(v_subject.capabilities) cap
  ) = v_caps then
    return to_jsonb(v_subject);
  end if;
  if v_subject.status<>'active' and p_status='active'
    and (select count(*) from public.editorial_memberships where status='active')>=10 then
    return jsonb_build_object('error','team_full');
  end if;
  update public.editorial_memberships set status=p_status,
    capabilities=v_caps,version=version+1,updated_at=now()
    where user_id=p_subject_id;
  insert into public.editorial_account_events(actor_id,subject_id,action,details)
    values(p_user_id,p_subject_id,'access_changed',jsonb_build_object(
      'previous_status',v_subject.status,'status',p_status,
      'previous_capabilities',v_subject.capabilities,
      'capabilities',v_caps,'version',v_subject.version+1));
  return (select to_jsonb(m) from public.editorial_memberships m
    where m.user_id=p_subject_id);
end
$$;

revoke all on function public.edge_api_editorial_reviewer_access(
  uuid,uuid,text,uuid,integer,text,text[]) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_reviewer_access(
  uuid,uuid,text,uuid,integer,text,text[]) to service_role;

commit;
