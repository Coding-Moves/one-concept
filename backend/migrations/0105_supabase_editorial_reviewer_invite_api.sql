-- Reviewer invitations bind a verified Auth identity after any provider call.
-- Prepare is read-only; finish rechecks authority and serializes membership writes.
begin;

create function public.edge_api_editorial_invite_prepare(
  p_user_id uuid, p_session_id uuid, p_aal text, p_email text
)
returns jsonb
language plpgsql stable
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
  return jsonb_build_object('user_id',v_identity,
    'needs_invite',v_identity is null);
end
$$;

create function public.edge_api_editorial_invite_finish(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_email text, p_invited_id uuid, p_capabilities text[]
)
returns jsonb
language plpgsql volatile
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
  insert into public.editorial_memberships(user_id,invited_email,capabilities)
    values(p_invited_id,p_email,v_caps);
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

commit;
