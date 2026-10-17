-- Cancel a generation job with the same account/catalog lock order and
-- request receipt used by the FastAPI editorial workflow.
begin;

create function public.edge_api_editorial_cancel_generation_job(
  p_user_id uuid, p_session_id uuid, p_aal text, p_job_id uuid,
  p_request_id uuid, p_note text, p_expected_token text, p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_receipt public.editorial_request_receipts%rowtype;
  v_job public.editorial_generation_jobs%rowtype;
  v_visible jsonb;
  v_note text;
begin
  if p_job_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_expected_token is null or p_expected_token !~ '^[a-f0-9]{64}$'
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
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
  select * into v_job from public.editorial_generation_jobs
    where id=p_job_id for update;
  if not found then return jsonb_build_object('error','job_not_found'); end if;
  v_visible := public.edge_api_editorial_job_public(v_job);
  if v_visible->>'token'<>p_expected_token then
    return jsonb_build_object('error','stale_revision');
  end if;
  if v_job.status not in ('pending','generating') then
    return jsonb_build_object('error','review_conflict',
      'message','Only pending or generating jobs can be cancelled');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict',
      'message','Record a substantive note of at least 10 characters');
  end if;
  update public.editorial_generation_jobs set status='cancelled',
    failure_code=null,result_revision_id=null,
    claim_token=case when v_job.status='generating' then claim_token else null end,
    claimed_at=case when v_job.status='generating' then claimed_at else null end,
    available_at=now()+interval '5 minutes',updated_at=clock_timestamp()
    where id=p_job_id;
  insert into public.editorial_workflow_events
    (revision_id,concept_id,topic_id,actor_id,registered_name,action,note,details)
    values(v_job.source_revision_id,v_job.concept_id,v_job.topic_id,
      p_user_id,v_actor->>'approved_name','comment',v_note,
      jsonb_build_object('generation_job_id',p_job_id,
        'generation_status','cancelled'));
  select public.edge_api_editorial_job_public(j) into v_visible
    from public.editorial_generation_jobs j where id=p_job_id;
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_visible);
  return v_visible;
end
$$;

revoke all on function public.edge_api_editorial_cancel_generation_job(
  uuid,uuid,text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.edge_api_editorial_cancel_generation_job(
  uuid,uuid,text,uuid,uuid,text,text,text) to service_role;

commit;
