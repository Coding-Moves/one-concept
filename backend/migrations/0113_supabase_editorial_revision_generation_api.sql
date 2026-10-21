-- Queue a correction only for the exact, currently reviewed revision.
begin;

create function public.edge_api_editorial_revision_generation(
  p_user_id uuid, p_session_id uuid, p_aal text, p_revision_id uuid,
  p_request_id uuid, p_note text, p_expected_token text,
  p_enabled boolean, p_queue_limit integer, p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_receipt public.editorial_request_receipts%rowtype;
  v_revision public.concept_revisions%rowtype;
  v_concept public.concepts%rowtype;
  v_topic_active boolean;
  v_subtopic_active boolean;
  v_subtopic_slug text;
  v_snapshot jsonb;
  v_token text;
  v_source_token text;
  v_feedback public.editorial_revision_events%rowtype;
  v_event uuid;
  v_job public.editorial_generation_jobs%rowtype;
  v_result jsonb;
  v_note text;
begin
  if p_revision_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_expected_token is null or p_expected_token !~ '^[a-f0-9]{64}$'
    or p_queue_limit is null or p_queue_limit<1 or p_queue_limit>250
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_receipt from public.editorial_request_receipts
    where actor_id=p_user_id and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>p_fingerprint then
      return jsonb_build_object('error','receipt_conflict');
    end if;
    return v_receipt.result;
  end if;
  if not coalesce(p_enabled,false) then
    return jsonb_build_object('error','generation_disabled');
  end if;
  select r.* into v_revision from public.concept_revisions r
    where r.id=p_revision_id for update;
  if not found then return jsonb_build_object('error','revision_not_found'); end if;
  select c.* into v_concept from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=v_revision.concept_id for update of c,t,s;
  select t.is_active,s.is_active,s.slug into
    v_topic_active,v_subtopic_active,v_subtopic_slug
    from public.topics t join public.subtopics s on s.topic_id=t.id
    where s.id=v_concept.subtopic_id;
  v_snapshot := to_jsonb(v_concept)-array['created_at','published_at','status'];
  v_token := encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'id',v_revision.id,'concept_id',v_revision.concept_id,
      'base_version',v_revision.base_version,'body',v_revision.body,
      'status',v_revision.status,'assigned_to',v_revision.assigned_to,
      'review_due_at',public.edge_api_editorial_utc_iso(v_revision.review_due_at),
      'source_snapshot',v_snapshot,'concept_status',v_concept.status,
      'topic_active',v_topic_active,'subtopic_active',v_subtopic_active,
      'subtopic_slug',v_subtopic_slug)), 'UTF8')),'hex');
  if v_token<>p_expected_token then
    return jsonb_build_object('error','stale_revision');
  end if;
  if v_revision.base_version<>v_concept.content_version
    or v_concept.status='archived' or not v_topic_active or not v_subtopic_active then
    return jsonb_build_object('error','review_conflict',
      'message','Revision is stale or content is retired');
  end if;
  if v_revision.status<>'changes_requested' then
    return jsonb_build_object('error','review_conflict',
      'message','Record a changes-requested decision on this revision first');
  end if;
  if exists(select 1 from public.concept_revisions r
    where r.concept_id=v_revision.concept_id and r.created_at>v_revision.created_at) then
    return jsonb_build_object('error','review_conflict',
      'message','A newer revision exists; review it before requesting AI changes');
  end if;
  if exists(select 1 from public.editorial_generation_jobs j
    where j.source_revision_id=p_revision_id or
      (j.concept_id=v_revision.concept_id and j.status in ('pending','generating'))) then
    return jsonb_build_object('error','review_conflict',
      'message','AI work already exists; inspect its status or stage a new revision');
  end if;
  if (select count(*) from public.editorial_generation_jobs j
    where j.topic_id=v_concept.topic_id and j.status in ('pending','generating'))
    >=p_queue_limit then
    return jsonb_build_object('error','review_conflict',
      'message','Revision generation queue is full; finish or cancel outstanding work first');
  end if;
  select * into v_feedback from public.editorial_revision_events e
    where e.revision_id=p_revision_id and e.action='changes_requested'
    order by e.created_at desc,e.id desc limit 1;
  if not found then
    return jsonb_build_object('error','review_conflict',
      'message','Changes-requested review evidence is missing');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict',
      'message','Record a substantive note of at least 10 characters');
  end if;
  insert into public.editorial_workflow_events
    (revision_id,concept_id,topic_id,actor_id,registered_name,action,note,details)
    values(p_revision_id,v_revision.concept_id,v_concept.topic_id,p_user_id,
      v_actor->>'approved_name','generation_requested',v_note,
      jsonb_build_object('kind','revision','feedback_event_id',v_feedback.id))
    returning id into v_event;
  v_source_token := encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'revision',v_token,'siblings',(
        select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb)
        from public.concept_revisions r where r.concept_id=v_revision.concept_id))),
      'UTF8')),'hex');
  insert into public.editorial_generation_jobs
    (source_revision_id,concept_id,topic_id,feedback_event_id,request_event_id,
     requested_by,source_token,source_body,feedback)
    values(p_revision_id,v_revision.concept_id,v_concept.topic_id,v_feedback.id,v_event,
      p_user_id,v_source_token,v_revision.body,v_feedback.note)
    returning * into v_job;
  v_token := encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'id',v_job.id,'status',v_job.status,'attempts',v_job.attempts,
      'updated_at',public.edge_api_editorial_utc_iso(v_job.updated_at))),
      'UTF8')),'hex');
  v_result := jsonb_build_object(
    'id',v_job.id,'source_revision_id',v_job.source_revision_id,
    'concept_id',v_job.concept_id,'topic_id',v_job.topic_id,
    'feedback_event_id',v_job.feedback_event_id,
    'request_event_id',v_job.request_event_id,
    'status',v_job.status,'attempts',v_job.attempts,
    'available_at',public.edge_api_editorial_utc_iso(v_job.available_at),
    'result_revision_id',v_job.result_revision_id,
    'failure_code',v_job.failure_code,
    'created_at',public.edge_api_editorial_utc_iso(v_job.created_at),
    'updated_at',public.edge_api_editorial_utc_iso(v_job.updated_at),
    'token',v_token);
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_result);
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_revision_generation(
  uuid,uuid,text,uuid,uuid,text,text,boolean,integer,text)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_revision_generation(
  uuid,uuid,text,uuid,uuid,text,text,boolean,integer,text)
  to service_role;

commit;
