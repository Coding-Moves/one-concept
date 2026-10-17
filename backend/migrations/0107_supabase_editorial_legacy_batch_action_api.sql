-- Versioned legacy batch actions keep the reviewer lock order, durable request
-- receipts, transition checks, and workflow audit evidence.
begin;

create function public.edge_api_editorial_legacy_batch_action(
  p_user_id uuid, p_session_id uuid, p_aal text, p_batch_id uuid,
  p_request_id uuid, p_note text, p_expected_token text,
  p_action text, p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_receipt public.editorial_request_receipts%rowtype;
  v_batch public.editorial_legacy_batches%rowtype;
  v_visible jsonb;
  v_note text;
  v_target text;
begin
  if p_batch_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_expected_token is null or p_expected_token !~ '^[a-f0-9]{64}$'
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_action is null or p_action not in ('pause','resume','cancel') then
    return jsonb_build_object('error','invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_receipt from public.editorial_request_receipts
    where actor_id=p_user_id and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>p_fingerprint then
      return jsonb_build_object('error','receipt_conflict');
    end if;
    return v_receipt.result;
  end if;
  select * into v_batch from public.editorial_legacy_batches
    where id=p_batch_id for update;
  if not found then return jsonb_build_object('error','batch_not_found'); end if;
  v_visible := public.edge_api_editorial_legacy_batch_public(v_batch);
  if v_visible->>'token'<>p_expected_token then
    return jsonb_build_object('error','stale_revision');
  end if;
  if not ((p_action='pause' and v_batch.status in ('queued','running'))
    or (p_action='resume' and v_batch.status in ('queued','paused'))
    or (p_action='cancel' and v_batch.status in ('queued','running','paused'))) then
    return jsonb_build_object('error','review_conflict',
      'message','This batch cannot make that transition');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict',
      'message','Record a substantive note of at least 10 characters');
  end if;
  v_target := case p_action when 'pause' then 'paused'
    when 'resume' then 'running' else 'cancelled' end;
  update public.editorial_legacy_batches set status=v_target,
    started_at=coalesce(started_at,clock_timestamp()),
    finished_at=case when v_target='cancelled' then clock_timestamp() else null end
    where id=p_batch_id;
  if p_action='cancel' then
    update public.editorial_legacy_batch_entries set status='skipped',
      claim_token=null,claimed_at=null,failure_code='batch_cancelled',
      updated_at=clock_timestamp()
      where batch_id=p_batch_id and status in ('queued','generating');
  end if;
  insert into public.editorial_workflow_events
    (topic_id,actor_id,registered_name,action,note,details)
    values(v_batch.topic_id,p_user_id,v_actor->>'approved_name',
      'comment',v_note,jsonb_build_object('kind','legacy_enrichment',
        'batch_id',p_batch_id,'action',p_action));
  select public.edge_api_editorial_legacy_batch_public(b) into v_visible
    from public.editorial_legacy_batches b where id=p_batch_id;
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_visible);
  return v_visible;
end
$$;

revoke all on function public.edge_api_editorial_legacy_batch_action(
  uuid,uuid,text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.edge_api_editorial_legacy_batch_action(
  uuid,uuid,text,uuid,uuid,text,text,text,text) to service_role;

commit;
